import { z } from "zod";

export const MAX_GOVERNANCE_ROUNDS = 5;
const RoundSchema = z.number().int().min(1).max(MAX_GOVERNANCE_ROUNDS);
const ReferenceSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9:_.-]{0,199}$/);
const ReferencesSchema = z.array(ReferenceSchema).max(24)
  .refine(refs => new Set(refs).size === refs.length, "观察引用不能重复");
const StopReasonSchema = z.enum([
  "goal_reached", "round_limit", "no_progress", "model_handoff",
  "approval_denied", "approval_expired", "approval_cancelled", "cancelled",
]);

export const GovernanceLoopStateSchema = z.object({
  contract_version: z.literal(1), task_id: z.uuid(), trace_id: z.string().min(1).max(200),
  round: RoundSchema, revision: z.number().int().nonnegative(),
  phase: z.enum(["acting", "waiting_approval", "verifying", "completed", "needs_human"]),
  consecutive_no_progress: z.number().int().min(0).max(2),
  pending_ref: ReferenceSchema.nullable(), stop_reason: StopReasonSchema.nullable(),
  last_observation_refs: ReferencesSchema,
  used_observation_refs: z.array(ReferenceSchema).max(MAX_GOVERNANCE_ROUNDS * 24)
    .refine(refs => new Set(refs).size === refs.length, "历史观察引用不能重复"),
}).strict().superRefine((state, ctx) => {
  const isTerminal = state.phase === "completed" || state.phase === "needs_human";
  const isWaiting = state.phase === "waiting_approval" || state.phase === "verifying";
  if (isTerminal !== (state.stop_reason !== null)
    || (state.phase === "completed" && state.stop_reason !== "goal_reached")
    || (state.phase === "needs_human" && state.stop_reason === "goal_reached")
    || isWaiting !== (state.pending_ref !== null)
    || (!isTerminal && state.consecutive_no_progress === 2)
    || state.revision < state.round - 1
    || (state.round > 1 && state.last_observation_refs.length === 0)
    || state.last_observation_refs.some(ref => !state.used_observation_refs.includes(ref))) {
    ctx.addIssue({ code: "custom", message: "治理检查点状态不一致" });
  }
});
export type GovernanceLoopState = z.infer<typeof GovernanceLoopStateSchema>;

const EventVersion = { round: RoundSchema, revision: z.number().int().nonnegative() };
const ActionEvent = { ...EventVersion, action_ref: ReferenceSchema };
const AssessmentSchema = z.object({
  decision: z.enum(["continue", "goal_reached", "handoff"]), progress: z.boolean(),
  evidence_refs: ReferencesSchema.refine(refs => refs.length > 0, "效果评估必须引用当前观察"),
}).strict();
const EventSchema = z.discriminatedUnion("type", [
  z.object({ ...EventVersion, type: z.literal("replan"),
    observation_refs: ReferencesSchema.refine(refs => refs.length > 0),
  }).strict(),
  z.object({ ...ActionEvent, type: z.literal("wait_approval") }).strict(),
  z.object({ ...ActionEvent, type: z.literal("approval_resolved"),
    outcome: z.enum(["approved", "denied", "expired", "cancelled", "invalidated"]) }).strict(),
  z.object({ ...ActionEvent, type: z.literal("result_unknown") }).strict(),
  z.object({ ...ActionEvent, type: z.literal("result_verified"), outcome: z.enum(["executed", "not_executed"]) }).strict(),
  z.object({ ...EventVersion, type: z.literal("cancel") }).strict(),
  z.object({ ...EventVersion, type: z.literal("evaluate"),
    observation_refs: ReferencesSchema.refine(refs => refs.length > 0, "必须重新读取本轮实际状态"),
    assessment: AssessmentSchema }).strict(),
]);
type EvaluationEvent = Extract<z.infer<typeof EventSchema>, { type: "evaluate" }>;

export const createGovernanceLoopState = (input: { task_id: string; trace_id: string }): GovernanceLoopState =>
  GovernanceLoopStateSchema.parse({ ...input, contract_version: 1, round: 1, revision: 0, phase: "acting",
    consecutive_no_progress: 0, pending_ref: null, stop_reason: null, last_observation_refs: [], used_observation_refs: [] });

const stop = (state: GovernanceLoopState, reason: z.infer<typeof StopReasonSchema>): GovernanceLoopState => ({
  ...state, phase: reason === "goal_reached" ? "completed" : "needs_human", stop_reason: reason, pending_ref: null,
});
const assertPhase = (state: GovernanceLoopState, phase: GovernanceLoopState["phase"], actionRef?: string) => {
  if (state.phase !== phase || (actionRef !== undefined && state.pending_ref !== actionRef)) {
    throw new Error("治理事件与当前阶段或等待动作不匹配");
  }
};

const assessRound = (state: GovernanceLoopState, event: EvaluationEvent): GovernanceLoopState => {
  assertPhase(state, "acting");
  const observations = new Set(event.observation_refs);
  if (event.assessment.evidence_refs.some(ref => !observations.has(ref))
    || event.observation_refs.some(ref => state.used_observation_refs.includes(ref))) {
    throw new Error("效果评估只能引用本轮新读取的实际状态");
  }
  const assessed = { ...state, last_observation_refs: event.observation_refs,
    used_observation_refs: [...state.used_observation_refs, ...event.observation_refs],
    consecutive_no_progress: event.assessment.progress ? 0 : state.consecutive_no_progress + 1 };
  if (event.assessment.decision === "goal_reached") return stop(assessed, "goal_reached");
  if (event.assessment.decision === "handoff") return stop(assessed, "model_handoff");
  if (assessed.consecutive_no_progress >= 2) return stop(assessed, "no_progress");
  if (state.round === MAX_GOVERNANCE_ROUNDS) return stop(assessed, "round_limit");
  return { ...assessed, round: state.round + 1 };
};

/** 仅供可信服务端编排；事件不授予权限，持久化与并发CAS由Workflow适配器负责。 */
export const transitionGovernanceLoop = (rawState: unknown, rawEvent: unknown): GovernanceLoopState => {
  const state = GovernanceLoopStateSchema.parse(rawState);
  const event = EventSchema.parse(rawEvent);
  if (state.phase === "completed" || state.phase === "needs_human") throw new Error("治理任务已终止");
  if (event.round !== state.round || event.revision !== state.revision) throw new Error("治理事件轮次或版本已过期");
  let next: GovernanceLoopState;
  switch (event.type) {
    case "replan":
      assertPhase(state, "acting");
      if (event.observation_refs.some(ref => state.used_observation_refs.includes(ref))) throw new Error("修订需要新观察");
      next = { ...state, last_observation_refs: event.observation_refs,
        used_observation_refs: [...state.used_observation_refs, ...event.observation_refs] };
      next = state.round === MAX_GOVERNANCE_ROUNDS ? stop(next, "round_limit") : { ...next, round: state.round + 1 };
      break;
    case "cancel": next = stop(state, "cancelled"); break;
    case "wait_approval":
      assertPhase(state, "acting");
      next = { ...state, phase: "waiting_approval", pending_ref: event.action_ref }; break;
    case "approval_resolved":
      assertPhase(state, "waiting_approval", event.action_ref);
      // 后端批准只恢复编排；实际执行仍须经过冻结授权、lease与网关复核。
      next = event.outcome === "approved" || event.outcome === "invalidated" ? { ...state, phase: "acting", pending_ref: null }
        : stop(state, `approval_${event.outcome}`); break;
    case "result_unknown":
      assertPhase(state, "acting");
      next = { ...state, phase: "verifying", pending_ref: event.action_ref }; break;
    case "result_verified":
      assertPhase(state, "verifying", event.action_ref);
      next = { ...state, phase: "acting", pending_ref: null }; break;
    case "evaluate": next = assessRound(state, event); break;
  }
  return GovernanceLoopStateSchema.parse({ ...next, revision: state.revision + 1 });
};
