// 工具白名单注册表：只有在此注册的工具才能被 Agent loop 调用（宪法 C-05/C-06）
// T-11 起逐步填充，本文件先建立类型与注册结构
export interface AgentTool {
  /** 工具唯一名称 */
  name: string;
  /** 工具用途描述（供模型选择与审计） */
  description: string;
  /** 风险等级：低风险直接执行，中高风险需人工确认 */
  riskLevel: "low" | "medium" | "high";
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
