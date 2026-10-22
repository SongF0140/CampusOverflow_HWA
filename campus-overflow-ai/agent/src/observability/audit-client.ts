import { z } from "zod";
import type { TraceId } from "../types/index.js";

export interface AuditEventInput {
  event_type: "plan" | "step_started" | "step_succeeded" | "step_failed";
  plan_revision: number;
  steps?: { step_id: string; tool_name: string }[];
  step_id?: string; tool_name?: string; duration_ms?: number;
}
export interface RunCreateInput { agent_run_id: string; task_type: string; input_summary: string }
export interface RunFinishInput { status: "succeeded" | "failed"; output_summary?: string; error_summary?: string }
const RunAck = z.object({
  id: z.number().int().positive(), user_id: z.number().int().positive(),
  agent_run_id: z.string(), trace_id: z.string(), status: z.enum(["running", "succeeded", "failed"]),
});
const EventAck = z.object({
  id: z.number().int().positive(), sequence_no: z.number().int().positive(),
  agent_run_id: z.string(), trace_id: z.string(),
  event_type: z.enum(["plan", "step_started", "step_succeeded", "step_failed"]),
  plan_revision: z.number().int().min(1).max(2),
  steps: z.array(z.object({ step_id: z.string(), tool_name: z.string() })).nullable().optional(),
  step_id: z.string().nullable().optional(), tool_name: z.string().nullable().optional(),
  duration_ms: z.number().int().nonnegative().nullable().optional(),
});
type AuditRequest = <T>(path: string, trace: TraceId, schema: z.ZodType<T>, method: "POST" | "PATCH", body: unknown) => Promise<T>;

/** 审计一律走双凭证用户路径，不回退服务级写入。 */
export const createAuditClient = (request: AuditRequest) => ({
  createRun: (body: RunCreateInput, trace: TraceId) => request("/internal/agent/user/runs", trace, RunAck, "POST", body),
  recordEvent: (id: string, body: AuditEventInput, trace: TraceId) => request(
    `/internal/agent/user/runs/${encodeURIComponent(id)}/events`, trace, EventAck, "POST", body,
  ),
  finishRun: (id: string, body: RunFinishInput, trace: TraceId) => request(
    `/internal/agent/user/runs/${encodeURIComponent(id)}`, trace, RunAck, "PATCH", body,
  ),
});
export type AuditClient = ReturnType<typeof createAuditClient>;
