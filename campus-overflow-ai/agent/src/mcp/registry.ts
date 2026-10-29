// MCP 工具注册表（T-17 N-01，US-19 / Q-11）：白名单注册，未注册工具一律不可调用。
// scope 决定调用资格（read / admin:query / admin:act）；管理员工具后续批次接入，
// 枚举在本文件一次定义，注册表/策略/测试共用，不散落字符串。
import { z } from "zod";
import type { GatewayOptions } from "../security/contracts.js";
import { executeThroughGateway } from "../tools/execution-gateway.js";

export const MCP_TOOL_SCOPES = ["read", "admin:query", "admin:act"] as const;
export type McpToolScope = (typeof MCP_TOOL_SCOPES)[number];

export interface McpToolContext {
  /** 调用方客户端名（审计与追溯用） */
  clientName: string;
  /** 本次调用生成的 trace 标识（mcp-<uuid>） */
  traceId: string;
  /** 取消信号（传输层断开时中断执行） */
  signal: AbortSignal;
}

export interface McpToolDefinition {
  name: string;
  description: string;
  scope: McpToolScope;
  /** JSON Schema（ListTools 对外展示用） */
  inputSchema: Record<string, unknown>;
  /** 入参校验（Zod），校验后的强类型参数传给 execute */
  validate: (args: unknown) => Record<string, unknown>;
  execute: (args: Record<string, unknown>, ctx: McpToolContext) => Promise<unknown>;
}

export class McpToolRegistry {
  private readonly tools = new Map<string, McpToolDefinition>();
  constructor(private readonly security: GatewayOptions = {}) {}

  registerTool(definition: McpToolDefinition): void {
    if (this.tools.has(definition.name)) {
      throw new Error(`MCP 工具重复注册：${definition.name}`);
    }
    this.tools.set(definition.name, { ...definition, execute: (input, context) => executeThroughGateway({
      ...this.security, name: definition.name, risk: "low", input,
      context: { ...context, source: "mcp" }, validate: definition.validate,
      execute: parsed => definition.execute(parsed as Record<string, unknown>, context),
    }) });
  }

  /** 未注册工具返回 undefined（由 server 层统一拒绝） */
  getTool(name: string): McpToolDefinition | undefined {
    return this.tools.get(name);
  }

  listTools(): McpToolDefinition[] {
    return [...this.tools.values()];
  }
}

/** 由 Zod schema 构造校验函数：非法入参抛错（server 层转 isError 结果） */
export const zodValidator = <T extends z.ZodType>(
  schema: T,
): ((args: unknown) => Record<string, unknown>) =>
(args) => {
  const parsed = schema.parse(args ?? {});
  return parsed as Record<string, unknown>;
};
