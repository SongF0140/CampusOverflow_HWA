// Agent 观测（T-16-B，US-18）：admin 运行列表与调用链详情数据源。
// 走同源 BFF（/api/backend/api/**），蛇形字段与后端 governance 契约一致。
import { apiFetch } from "./client";
import type {
  ModerationCaseItem,
} from "@/shared/types/governance";

export interface AgentRunItem {
  id: number;
  user_id: number | null;
  task_type: string;
  trace_id: string;
  agent_run_id: string;
  input_summary: string;
  output_summary: string | null;
  error_summary: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface AgentRunList {
  items: AgentRunItem[];
  total: number;
  page: number;
  page_size: number;
}

export interface AgentRunEventItem {
  id: number;
  agent_run_id: string;
  sequence_no: number;
  event_type: string;
  plan_revision: number;
  steps: Array<{ step_id: string; tool_name: string }> | null;
  step_id: string | null;
  tool_name: string | null;
  duration_ms: number | null;
  trace_id: string;
  created_at: string;
}

export interface ToolCallItem {
  id: number;
  agent_run_id: string;
  tool_name: string;
  args_summary: string | null;
  result_summary: string | null;
  status: string;
  duration_ms: number | null;
  trace_id: string;
  created_at: string;
}

/** 单运行完整调用链（US-18 完成判定：trace 可检索、失败可定位） */
export interface AgentRunTrace {
  run: AgentRunItem;
  events: AgentRunEventItem[];
  tool_calls: ToolCallItem[];
  related_cases: ModerationCaseItem[];
}

export function fetchAgentRuns(
  params: { page?: number; page_size?: number; status?: string; task_type?: string; user_id?: number } = {},
) {
  const query = new URLSearchParams();
  if (params.page !== undefined) query.set("page", String(params.page));
  if (params.page_size !== undefined) query.set("page_size", String(params.page_size));
  if (params.status) query.set("status", params.status);
  if (params.task_type) query.set("task_type", params.task_type);
  if (params.user_id !== undefined) query.set("user_id", String(params.user_id));
  const suffix = query.toString() ? `?${query.toString()}` : "";
  return apiFetch<AgentRunList>(`/governance/agent-runs${suffix}`);
}

export function fetchAgentRunTrace(agentRunId: string) {
  return apiFetch<AgentRunTrace>(
    `/governance/agent-runs/${encodeURIComponent(agentRunId)}`,
  );
}
