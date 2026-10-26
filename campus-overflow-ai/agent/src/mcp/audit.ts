// MCP 调用审计（T-17 N-01，US-18 / AG-R03）：记录客户端、工具、参数与结果
// 摘要、状态、耗时、trace——只存受控脱敏摘要，不存完整原文与凭证（C-07/C-08）。
// 本批为结构化日志；持久化存储需要归属模型，登记后续批次。
import { buildSummary } from "../observability/sensitive.js";

export interface McpCallAuditRecord {
  event: "mcp_tool_call";
  client: string;
  tool: string;
  status: "succeeded" | "failed" | "denied" | "unregistered";
  args_summary: string;
  result_summary: string | null;
  error_summary: string | null;
  duration_ms: number;
  trace_id: string;
}

export interface McpCallAudit {
  record: (record: McpCallAuditRecord) => void;
}

/** 默认实现：结构化日志（stderr），供运维采集；测试注入内存实现 */
export const consoleMcpCallAudit = (): McpCallAudit => ({
  record: (record) => {
    console.error(JSON.stringify(record));
  },
});

export const summarizeArgs = (args: unknown): string =>
  buildSummary(JSON.stringify(args ?? {}), 200);

export const summarizeResult = (result: unknown): string =>
  buildSummary(JSON.stringify(result ?? null), 200);

export const summarizeError = (error: unknown): string => {
  const message = error instanceof Error ? error.message : String(error);
  // 底层异常可能带后端响应片段：统一脱敏截断，不透传原始内容
  return buildSummary(message, 200);
};
