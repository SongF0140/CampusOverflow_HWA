import { createGovernanceLoopState, transitionGovernanceLoop } from "./governance-loop-state.js";

export interface GovernanceAction { action: string; reason: string; duration_days: number | null }
export interface GovernanceObservation { observation_ref: string; [key: string]: unknown }
export interface GovernanceAssessment { decision: "continue" | "goal_reached" | "handoff"; progress: boolean; evidence_refs: string[] }
export interface GovernanceRoundDeps {
  observe(): Promise<GovernanceObservation>;
  plan(observation: GovernanceObservation, round: number): Promise<{ actions: GovernanceAction[] }>;
  propose(round: number, index: number, action: GovernanceAction): Promise<string>;
  approval(requestId: string): Promise<string>;
  execute(requestId: string): Promise<"executed" | "unknown">;
  evaluate(observation: GovernanceObservation, round: number): Promise<GovernanceAssessment>;
  wait(): Promise<void>; finish(status: "completed" | "needs_human", reason: string): Promise<void>;
  activeMs(): number;
}

/** 运行于Workflow确定性上下文；所有副作用由持久step代理提供，sleep不消耗活动时间。 */
export const runGovernanceRounds = async (task: { task_id: string; trace_id: string }, deps: GovernanceRoundDeps) => {
  let state = createGovernanceLoopState({ task_id: task.task_id, trace_id: task.trace_id });
  let toolCalls = 0;
  const event = (input: Record<string, unknown>) => {
    state = transitionGovernanceLoop(state, { round: state.round, revision: state.revision, ...input });
  };
  const finish = async (reason: string) => {
    const status = reason === "goal_reached" ? "completed" : "needs_human";
    await deps.finish(status, reason);
    return { status, reason, checkpoint: state, tool_calls: toolCalls, active_ms: deps.activeMs() };
  };
  const checkBudget = () => {
    if (deps.activeMs() >= 120_000) throw new Error("active_time_budget");
    if (toolCalls >= 40) throw new Error("tool_call_budget");
  };
  const tool = async <T>(call: () => Promise<T>): Promise<T> => { checkBudget(); toolCalls++; return call(); };
  try {
    while (state.phase === "acting") {
      const before = await tool(deps.observe);
      const plan = await deps.plan(before, state.round);
      if (plan.actions.length > 3) throw new Error("invalid_plan");
      for (const [index, action] of plan.actions.entries()) {
        const requestId = await tool(() => deps.propose(state.round, index, action));
        event({ type: "wait_approval", action_ref: requestId });
        let approval = await deps.approval(requestId);
        while (approval === "pending") {
          checkBudget(); await deps.wait(); approval = await deps.approval(requestId);
        }
        const outcome = ["approved", "executed"].includes(approval) ? "approved"
          : approval === "rejected" ? "denied" : approval === "expired" ? "expired" : "cancelled";
        event({ type: "approval_resolved", action_ref: requestId, outcome });
        if (state.stop_reason) return finish(state.stop_reason);
        let executed = await tool(() => deps.execute(requestId));
        if (executed === "unknown") {
          event({ type: "result_unknown", action_ref: requestId });
          // 只核对/重试同一execution，绝不换request或参数重新执行。
          for (let attempt = 0; attempt < 3 && executed === "unknown"; attempt++) {
            checkBudget(); await deps.wait(); executed = await tool(() => deps.execute(requestId));
          }
          if (executed === "unknown") return finish("result_unknown");
          event({ type: "result_verified", action_ref: requestId, outcome: "executed" });
        }
      }
      const after = await tool(deps.observe);
      if (deps.activeMs() >= 120_000) throw new Error("active_time_budget");
      const assessment = await deps.evaluate(after, state.round);
      event({ type: "evaluate", observation_refs: [after.observation_ref], assessment });
    }
    return finish(state.stop_reason ?? "model_handoff");
  } catch (error) {
    const reason = error instanceof Error && ["active_time_budget", "tool_call_budget"].includes(error.message)
      ? error.message : "workflow_error";
    return finish(reason);
  }
};
