import type { AgentPrincipal } from "./principal.js";

/** 各端继承同一公共只读能力；注册、主规则和任务范围还须进一步取交集。 */
export const COMMON_READ_TOOLS = [
  "searchCourses", "searchQuestions", "fetchTags", "fetchKnowledgeTree", "fetchModerationTarget",
  "listKnowledgeCards", "fetchKnowledgeCard", "fetchKnowledgeBody", "fetchMainMemory", "fetchCertifiedAnswer",
  "searchWeb", "readWebPage",
] as const;

const TEACHER_ACTIONS = ["proposeClassMembership", "readClassMembershipResult", "proposeTeachingExperience"];
const ROLE_ACTIONS: Record<AgentPrincipal["role"], readonly string[]> = {
  student: [], teacher: TEACHER_ACTIONS,
  admin: [...TEACHER_ACTIONS, "proposeGovernance", "readGovernanceResult"],
};

/** 角色能力上限；主规则可收窄，但不能扩大固定角色权限。 */
export const roleActionNames = (role: AgentPrincipal["role"]): readonly string[] => ROLE_ACTIONS[role];
