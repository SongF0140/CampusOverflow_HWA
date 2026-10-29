import { describe, expect, it } from "vitest";
import { createRoleActionTools } from "../src/tools/role-actions.js";
import { createChildRegistry } from "../src/agents/controller.js";
import { createToolRegistry } from "../src/tools/registry.js";
import { readMainRules } from "../src/memory/main-context.js";

const principal = (role: "student" | "teacher" | "admin") => ({ user_id: 1, role, status: "active" as const,
  identity_type: "undergraduate" as const, assistant_cert_status: "none" as const });

describe("角色动作工具面", () => {
  it("学生不能提出治理或名单写申请", () => {
    expect(createRoleActionTools({} as never, principal("student"))).toEqual([]);
  });
  it("教师与管理员工具集分离，任何角色均没有模型确认工具", () => {
    expect(createRoleActionTools({} as never, principal("teacher")).map(t => t.name)).toEqual(["proposeClassMembership", "readClassMembershipResult", "proposeTeachingExperience"]);
    expect(createRoleActionTools({} as never, principal("admin")).map(t => t.name)).toEqual(["proposeGovernance", "readGovernanceResult"]);
  });
  it("学生不能靠篡改主规则获得管理员工具", () => {
    const base = createToolRegistry();
    for (const tool of createRoleActionTools({} as never, principal("admin"))) base.registerTool(tool);
    const rules = readMainRules();
    rules.tool_rules.student.push("proposeGovernance");
    const child = createChildRegistry(base, () => rules, principal("student"));
    expect(child.getTool("proposeGovernance")).toBeUndefined();
  });
});
