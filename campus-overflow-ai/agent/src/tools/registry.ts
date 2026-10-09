// 工具白名单注册表：只有在此注册的工具才能被 Agent loop 调用（宪法 C-05/C-06）
// medium/high 风险工具仅保留类型位，执行须走 T-15 审批工单，本期不提供执行通道
import { tool as sdkTool, type ToolSet } from "ai";
import { z } from "zod";

import type { AgentRunId, RiskLevel, TraceId } from "../types/index.js";

/** 工具执行上下文：随每次 run 构建工具集时闭包注入，用于观测与追踪 */
export interface ToolExecutionContext {
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

const registry = new Map<string, AgentTool>();

/** 注册工具：重复注册视为配置错误 */
export const registerTool = (tool: AgentTool): void => {
  if (registry.has(tool.name)) {
    throw new Error(`tool already registered: ${tool.name}`);
  }
  registry.set(tool.name, tool);
};

/** 获取全部已注册工具（白名单） */
export const listTools = (): AgentTool[] => Array.from(registry.values());

/** 按名称查询工具；未注册返回 undefined */
export const getTool = (name: string): AgentTool | undefined => registry.get(name);

/** 白名单守卫：未注册或非低风险一律拒绝执行 */
export const assertToolAllowed = (name: string): AgentTool => {
  const registered = registry.get(name);
  if (!registered) {
    throw new Error(`tool not whitelisted: ${name}`);
  }
  if (registered.riskLevel !== "low") {
    // 高风险动作绝不直接执行（AGENTS.md 硬性约束 2）
    throw new Error(`non-low risk tool requires approval flow: ${name}`);
  }
  return registered;
};

/** 将注册表转换为 AI SDK 工具集：仅包含有 execute 的低风险工具，执行前再次过白名单守卫 */
export const toSdkTools = (context: ToolExecutionContext): ToolSet => {
  const toolSet: ToolSet = {};
  for (const registered of listTools()) {
    if (!registered.execute) {
      continue;
    }
    const execute = registered.execute;
    toolSet[registered.name] = sdkTool({
      description: registered.description,
      inputSchema: registered.inputSchema ?? z.unknown(),
      execute: async (input: unknown) => {
        // 每次工具调用都重新校验白名单与风险等级，防止注册表变更后绕过
        assertToolAllowed(registered.name);
        return execute(input, context);
      },
    });
  }
  return toolSet;
};
