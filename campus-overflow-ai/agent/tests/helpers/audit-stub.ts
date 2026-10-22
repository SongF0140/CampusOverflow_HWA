import { vi } from "vitest";
import type { TraceId } from "../../src/types";

interface RunData {
  id: number; user_id: number; agent_run_id: string; trace_id: string;
  status: "running" | "succeeded" | "failed";
}
interface EventData {
  event_type: "plan" | "step_started" | "step_succeeded" | "step_failed";
  plan_revision: number;
  steps?: { step_id: string; tool_name: string }[];
  step_id?: string; tool_name?: string; duration_ms?: number;
}

/** 模拟后端成功信封的数据；不替代生产记录器，不模拟权限规则。 */
export function auditStub(userId = 3) {
  const runs = new Map<string, RunData>();
  let sequence = 0;
  return {
    createRun: vi.fn(async (input: { agent_run_id: string; task_type: string; input_summary: string }, trace: TraceId) => {
      const data: RunData = { id: 1, user_id: userId, agent_run_id: input.agent_run_id, trace_id: trace, status: "running" };
      runs.set(input.agent_run_id, data);
      return data;
    }),
    recordEvent: vi.fn(async (id: string, input: EventData, trace: TraceId) => ({
      ...input, id: ++sequence, sequence_no: sequence, agent_run_id: id, trace_id: trace,
    })),
    finishRun: vi.fn(async (id: string, input: { status: "succeeded" | "failed"; output_summary?: string; error_summary?: string }, trace: TraceId) => ({
      ...runs.get(id)!, agent_run_id: id, trace_id: trace, status: input.status,
    })),
  };
}
