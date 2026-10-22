import { InternalApiError } from "../internal-client.js";
import { checkSignal, RunStoppedError, waitForSignal, withUpstreamDeadline } from "../loop/abort.js";
import type { PlanList, PlanStep } from "../types/plan.js";
import type { AuditClient, AuditEventInput } from "./audit-client.js";
import type { RunContext } from "./run-context.js";

export interface PlanAudit {
  recordPlan: (plan: PlanList) => Promise<void>;
  beforeStep: (step: PlanStep) => Promise<void>;
  afterStep: (step: PlanStep, status: "succeeded" | "failed", durationMs: number) => Promise<void>;
}
export class AuditPersistenceError extends Error {
  constructor(readonly phase: string, readonly run: RunContext, readonly status: 401 | 403 | 503) {
    super("运行记录未完成，请稍后重试");
    this.name = "AuditPersistenceError";
  }
}

/** 每次请求独立持有审计客户端；运行上下文和模型输入不持有客户端凭证。 */
export class PersistentRunAudit implements PlanAudit {
  private created = false;
  private terminalAttempted = false;
  private revision = 0;
  private sequence = 0;
  constructor(private readonly client: AuditClient, readonly run: RunContext) {}

  private async persist<T>(phase: string, action: () => Promise<T>, detached = false): Promise<T> {
    try { return await waitForSignal(detached ? undefined : this.run.signal, action); }
    catch (error) {
      console.error(JSON.stringify({ event: "agent_audit_failed", phase,
        agent_run_id: this.run.agentRunId, trace_id: this.run.traceId }));
      if (!detached && phase !== "finish" && error instanceof RunStoppedError) throw error;
      const status = error instanceof InternalApiError && (error.status === 401 || error.status === 403) ? error.status : 503;
      throw new AuditPersistenceError(phase, this.run, status);
    }
  }
  private checkAck(ack: { agent_run_id: string; trace_id: string }): void {
    if (ack.agent_run_id !== this.run.agentRunId || ack.trace_id !== this.run.traceId) throw new Error("审计响应关联错误");
  }
  async create(): Promise<void> {
    await this.persist("create", async () => {
      const result = await this.client.createRun({ agent_run_id: this.run.agentRunId,
        task_type: this.run.taskType, input_summary: `用户任务：${this.run.taskType}` }, this.run.traceId);
      this.checkAck(result);
      if (result.user_id !== this.run.principal?.user_id || result.status !== "running") throw new Error("审计归属错误");
      this.created = true;
    });
  }
  private async event(body: AuditEventInput): Promise<void> {
    await this.persist(body.event_type, async () => {
      const ack = await this.client.recordEvent(this.run.agentRunId, body, this.run.traceId);
      this.checkAck(ack);
      if (ack.sequence_no !== this.sequence + 1 || ack.plan_revision !== body.plan_revision
        || ack.event_type !== body.event_type || (ack.step_id ?? null) !== (body.step_id ?? null)
        || (ack.tool_name ?? null) !== (body.tool_name ?? null)
        || JSON.stringify(ack.steps ?? null) !== JSON.stringify(body.steps ?? null)) throw new Error("审计事件错配");
      this.sequence = ack.sequence_no;
    });
  }
  async recordPlan(plan: PlanList): Promise<void> {
    await this.event({ event_type: "plan", plan_revision: this.revision + 1,
      steps: plan.steps.map((step) => ({ step_id: step.stepId, tool_name: step.toolName })) });
    this.revision += 1;
  }
  async beforeStep(step: PlanStep): Promise<void> {
    await this.event({ event_type: "step_started", plan_revision: this.revision,
      step_id: step.stepId, tool_name: step.toolName });
  }
  async afterStep(step: PlanStep, status: "succeeded" | "failed", durationMs: number): Promise<void> {
    await this.event({ event_type: status === "succeeded" ? "step_succeeded" : "step_failed",
      plan_revision: this.revision, step_id: step.stepId, tool_name: step.toolName, duration_ms: durationMs });
  }
  async finish(status: "succeeded" | "failed", stopped?: RunStoppedError): Promise<void> {
    if (status === "succeeded") checkSignal(this.run.signal);
    this.terminalAttempted = true;
    await this.persist("finish", async () => {
      const body = { status, ...(status === "succeeded" ? { output_summary: "任务已完成" }
        : { error_summary: stopped?.summary ?? "任务未完成" }) };
      const result = status === "succeeded"
        ? await this.client.finishRun(this.run.agentRunId, body, this.run.traceId)
        : await withUpstreamDeadline(undefined, (signal) =>
          this.client.finishRun(this.run.agentRunId, body, this.run.traceId, signal), 5_000);
      this.checkAck(result);
      if (result.status !== status || result.user_id !== this.run.principal?.user_id) throw new Error("审计终态错配");
    }, status === "failed");
  }
  async onFailure(original: unknown): Promise<unknown> {
    if (this.created && !this.terminalAttempted) {
      try { await this.finish("failed", original instanceof RunStoppedError ? original : undefined); }
      catch (error) { return error; }
    }
    return original;
  }
}
