// 工具白名单注册表：只有在此注册的工具才能被 Agent loop 调用（宪法 C-05/C-06）
// medium/high 风险工具仅保留类型位，执行须走 T-15 审批工单，本期不提供执行通道
import { tool as sdkTool, type ToolSet } from "ai";
import { z } from "zod";

import type { AgentPrincipal } from "../auth/principal.js";
import type { AgentRunId, RiskLevel, TraceId } from "../types/index.js";
import type { GatewayContext, GatewayOptions, HookStage } from "../security/contracts.js";
import { checkHook, checkInvocation } from "../security/hooks.js";
import { executeThroughGateway } from "./execution-gateway.js";

/** 工具执行上下文：随每次 run 构建工具集时闭包注入，用于观测与追踪 */
export interface ToolExecutionContext extends GatewayContext {
  readonly signal?: AbortSignal;
  readonly principal?: AgentPrincipal;
  agentRunId: AgentRunId;
  traceId: TraceId;
}

export interface AgentTool {
  /** 工具唯一名称 */
  name: string;
  /** 工具用途描述（供模型选择与审计） */
  description: string;
  /** 风险等级：low 直接执行，medium/high 本期仅注册不执行 */
  riskLevel: RiskLevel;
  /** 入参 Zod schema：模型生成入参经 SDK 校验后进入 execute */
  inputSchema?: z.ZodType;
  /** 工具实现；缺省表示仅登记元信息（如 T-15/T-17 预留位） */
  execute?: (input: unknown, context: ToolExecutionContext) => Promise<unknown>;
}

export const createToolRegistry = (options: GatewayOptions = {}) => {
  const registry = new Map<string, AgentTool>();

  const registerTool = (tool: AgentTool): void => {
    if (registry.has(tool.name)) throw new Error(`tool already registered: ${tool.name}`);
    const execute = tool.execute;
    registry.set(tool.name, execute ? { ...tool, get riskLevel() { return tool.riskLevel; }, execute: (input, context) => executeThroughGateway({
      ...options, name: tool.name, risk: tool.riskLevel, input, context,
      validate: tool.inputSchema ? raw => tool.inputSchema!.parse(raw) : undefined,
      execute: parsed => execute(parsed, context),
    }) } : tool);
  };
  const listTools = (): AgentTool[] => Array.from(registry.values());
  const getTool = (name: string): AgentTool | undefined => registry.get(name);
  const checkLifecycle = async (stage: HookStage, context: ToolExecutionContext, input: unknown = {}) => {
    checkInvocation("low", {}, context);
    await checkHook(options.hooks, { stage, source: context.source ?? "chat", toolName: "lifecycle", input, traceId: context.traceId });
  };

  const assertToolAllowed = (name: string): AgentTool => {
    const registered = registry.get(name);
    if (!registered) throw new Error(`tool not whitelisted: ${name}`);
    if (registered.riskLevel !== "low") {
      throw new Error(`non-low risk tool requires approval flow: ${name}`);
    }
    return registered;
  };

  const toSdkTools = (context: ToolExecutionContext): ToolSet => {
    const toolSet: ToolSet = {};
    for (const registered of listTools()) {
      if (!registered.execute || registered.riskLevel !== "low") continue;
      const execute = registered.execute;
      toolSet[registered.name] = sdkTool({
        description: registered.description,
        inputSchema: registered.inputSchema ?? z.unknown(),
        execute: async (input: unknown) => {
          // 工具展示时过滤，执行前再次校验，防止装配后风险策略变化。
          assertToolAllowed(registered.name);
          return execute(input, context);
        },
      });
    }
    return toolSet;
  };
  return { registerTool, listTools, getTool, assertToolAllowed, toSdkTools, checkLifecycle };
};

export type ToolRegistry = ReturnType<typeof createToolRegistry>;

/** 保留独立工具测试的默认注册表；HTTP 用户运行必须创建请求级注册表。 */
export const defaultToolRegistry = createToolRegistry();
export const { registerTool, listTools, getTool, assertToolAllowed, toSdkTools } = defaultToolRegistry;
