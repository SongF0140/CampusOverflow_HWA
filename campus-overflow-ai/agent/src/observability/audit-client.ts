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
  id: z.number().int().positive(), user_id: z.number().int().positive().nullable(),
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
type AuditRequest = <T>(path: string, trace: TraceId, schema: z.ZodType<T>, method: "POST" | "PATCH", body: unknown, signal?: AbortSignal) => Promise<T>;

/** 用户运行一律走双凭证 user 路径；服务级系统运行（无用户归属）走旧服务路径，均不互相回退。 */
export const createAuditClient = (
  request: AuditRequest,
  prefix: "/internal/agent/user" | "/internal/agent" = "/internal/agent/user",
) => ({
  createRun: (body: RunCreateInput, trace: TraceId) => request(`${prefix}/runs`, trace, RunAck, "POST", body),
  recordEvent: (id: string, body: AuditEventInput, trace: TraceId) => request(
    `${prefix}/runs/${encodeURIComponent(id)}/events`, trace, EventAck, "POST", body,
  ),
  finishRun: (id: string, body: RunFinishInput, trace: TraceId, signal?: AbortSignal) => request(
    `${prefix}/runs/${encodeURIComponent(id)}`, trace, RunAck, "PATCH", body, signal,
  ),
});
export type AuditClient = ReturnType<typeof createAuditClient>;
