import { AgentPrincipalSchema, type AgentPrincipal } from "../auth/principal.js";
import type { MainRules } from "../memory/main-context.js";
import { createToolRegistry, type AgentTool, type ToolExecutionContext, type ToolRegistry } from "../tools/registry.js";

const READ_TOOLS = new Set([
  "searchCourses", "searchQuestions", "fetchTags", "fetchKnowledgeTree", "fetchModerationTarget",
  "listKnowledgeCards", "fetchKnowledgeCard", "fetchKnowledgeBody",
  "fetchMainMemory", "fetchCertifiedAnswer",
]);

/** 主 Agent 只能收窄只读工具；所有工具执行仍由后端重新核验身份和数据范围。 */
export const createChildRegistry = (
  base: ToolRegistry, rulesProvider: () => MainRules, principal: AgentPrincipal,
): ToolRegistry => {
  const bound = AgentPrincipalSchema.parse(principal);
  const allowed = (name: string): boolean => {
    try {
      const tool = base.getTool(name);
      const roleAllowed = READ_TOOLS.has(name)
        || (bound.role === "admin" && ["proposeGovernance", "readGovernanceResult"].includes(name))
        || (bound.role === "teacher" && ["proposeClassMembership", "readClassMembershipResult", "proposeTeachingExperience"].includes(name));
      return !!tool && tool.riskLevel === "low" && roleAllowed
        && rulesProvider().tool_rules[bound.role].includes(name);
    } catch { return false; }
  };
  const assertToolAllowed = (name: string): AgentTool => {
    if (!allowed(name)) throw new Error("子 Agent 工具权限已拒绝或规则已更新");
    const tool = base.assertToolAllowed(name);
    return { ...tool, execute: tool.execute ? async (input, context) => {
      // 旧工具引用不能绕过新的规则；使用当前基础工具，避免执行失效闭包。
      if (!allowed(name)) throw new Error("子 Agent 工具权限已拒绝或规则已更新");
      if (context.principal && (context.principal.user_id !== bound.user_id
        || context.principal.role !== bound.role || context.principal.status !== "active")) {
        throw new Error("子 Agent 执行身份不匹配");
      }
      return base.assertToolAllowed(name).execute?.(input, { ...context, principal: bound });
    } : undefined };
  };
  const listTools = (): AgentTool[] => base.listTools().filter(item => allowed(item.name))
    .map(item => assertToolAllowed(item.name));
  const getTool = (name: string): AgentTool | undefined => allowed(name) ? assertToolAllowed(name) : undefined;
  const registerTool = (): never => { throw new Error("子 Agent 不允许注册工具"); };
  const toSdkTools = (context: ToolExecutionContext) => {
    const child = createToolRegistry();
    for (const tool of listTools()) child.registerTool(tool);
    return child.toSdkTools({ ...context, principal: context.principal ?? bound });
  };
  return { registerTool, listTools, getTool, assertToolAllowed, toSdkTools };
};
