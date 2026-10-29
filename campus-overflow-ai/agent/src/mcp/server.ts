// MCP Server 核心（T-17 N-01，US-19 / Q-11）：白名单 + scope 策略 + 调用审计。
// 错误以 isError 结果在协议内表达（未注册/scope 不足/执行失败均不崩会话）——
// "MCP 调用失败不影响核心问答"：MCP 与聊天/任务是完全独立的代码路径。
import { randomUUID } from "node:crypto";

import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";

import {
  assertCallAllowed,
  McpScopeDeniedError,
  type McpClientPrincipal,
} from "./policy.js";
import {
  McpToolRegistry,
  type McpToolContext,
} from "./registry.js";
import {
  consoleMcpCallAudit,
  summarizeArgs,
  summarizeError,
  summarizeResult,
  type McpCallAudit,
} from "./audit.js";

export interface McpServerDeps {
  registry: McpToolRegistry;
  principal: McpClientPrincipal;
  audit?: McpCallAudit;
  authorize?: (principal: McpClientPrincipal) => Promise<void>;
}

export const MCP_SERVER_INFO = { name: "campus-overflow-ai", version: "0.1.0" } as const;

/** 组装 MCP Server 实例（传输由调用方连接：InMemory 测试 / Streamable HTTP 生产）。
 * principal 仅含服务端配置映射出的 name/scopes 字段（不携带请求原文）。 */
export const attachMcpToolHandlers = (deps: McpServerDeps): Server => {
  const audit = deps.audit ?? consoleMcpCallAudit();
  const server = new Server(MCP_SERVER_INFO, { capabilities: { tools: {} } });

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: deps.registry.listTools().map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const toolName = request.params.name;
    const privateContext = deps.registry.getTool(toolName)?.privateContext === true;
    const startedAt = Date.now();
    const traceId = `mcp-${randomUUID()}`;
    const finish = (
      status: "succeeded" | "failed" | "denied" | "unregistered",
      resultSummary: string | null,
      errorSummary: string | null,
      isError: boolean,
      message: string,
    ) => {
      audit.record({
        event: "mcp_tool_call", client: deps.principal.name, tool: toolName,
        status, args_summary: privateContext ? "私人会话参数不记录" : summarizeArgs(request.params.arguments),
        result_summary: privateContext && resultSummary ? "私人会话结果不记录" : resultSummary,
        error_summary: privateContext && errorSummary ? "私人会话调用失败" : errorSummary,
        duration_ms: Date.now() - startedAt, trace_id: traceId,
      });
      return {
        isError,
        content: [{ type: "text" as const, text: message }],
      };
    };

    const tool = deps.registry.getTool(toolName);
    if (!tool) {
      // US-19：未注册工具不可被调用——拒绝信息不暴露注册表内容
      return finish("unregistered", null, "unregistered tool", true, "工具未注册，拒绝调用");
    }
    try {
      assertCallAllowed(deps.principal, tool);
    } catch (error) {
      const required = error instanceof McpScopeDeniedError ? error.requiredScope : "unknown";
      return finish("denied", null, summarizeError(error), true,
        `无权调用该工具（需要 ${required} 权限范围）`);
    }

    const ctx: McpToolContext = {
      clientName: deps.principal.name, traceId,
      signal: new AbortController().signal,
    };
    try {
      const args = tool.validate(request.params.arguments ?? {});
      await deps.authorize?.(deps.principal);
      const result = await tool.execute(args, ctx);
      return finish("succeeded", summarizeResult(result), null, false,
        JSON.stringify(result));
    } catch (error) {
      // 执行失败：脱敏原因经 isError 结果返回，不透传底层异常原文
      return finish("failed", null, summarizeError(error), true, "工具执行失败，请稍后重试");
    }
  });

  return server;
};
