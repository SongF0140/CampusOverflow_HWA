import type { AgentPrincipal } from "./principal.js";

const TEACHER_ACTIONS = ["proposeClassMembership", "readClassMembershipResult", "proposeTeachingExperience"];
const ROLE_ACTIONS: Record<AgentPrincipal["role"], readonly string[]> = {
  student: [], teacher: TEACHER_ACTIONS,
  admin: [...TEACHER_ACTIONS, "proposeGovernance", "readGovernanceResult"],
};

/** 角色能力上限；主规则可收窄，但不能扩大固定角色权限。 */
export const roleActionNames = (role: AgentPrincipal["role"]): readonly string[] => ROLE_ACTIONS[role];
