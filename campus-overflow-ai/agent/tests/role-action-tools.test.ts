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
  it("管理员继承教师工具并叠加治理，任何角色均没有模型确认工具", () => {
    expect(createRoleActionTools({} as never, principal("teacher")).map(t => t.name)).toEqual(["proposeClassMembership", "readClassMembershipResult", "proposeTeachingExperience"]);
    const teacherNames = createRoleActionTools({} as never, principal("teacher")).map(t => t.name);
    const adminNames = createRoleActionTools({} as never, principal("admin")).map(t => t.name);
    expect(adminNames).toEqual(expect.arrayContaining([...teacherNames, "proposeGovernance", "readGovernanceResult"]));
    expect(adminNames.some(name => /confirm|publish|approve/i.test(name))).toBe(false);
  });
  it("管理员的默认规则与执行器同时允许继承的教师工具", () => {
    const base = createToolRegistry();
    const teacherTools = createRoleActionTools({} as never, principal("teacher"));
    for (const tool of teacherTools) base.registerTool(tool);
    const rules = readMainRules();
    const admin = createChildRegistry(base, () => rules, principal("admin"));
    expect(admin.listTools().map(t => t.name)).toEqual(teacherTools.map(t => t.name));
  });
  it("学生不能靠篡改主规则获得管理员工具", () => {
    const base = createToolRegistry();
    for (const tool of createRoleActionTools({} as never, principal("admin"))) base.registerTool(tool);
    const rules = readMainRules();
    rules.tool_rules.student.push("proposeGovernance");
    const child = createChildRegistry(base, () => rules, principal("student"));
    expect(child.getTool("proposeGovernance")).toBeUndefined();
  });
  it("已有规则文件中教师能力也被管理员继承，治理仍需管理员规则授权", () => {
    const base = createToolRegistry();
    for (const tool of createRoleActionTools({} as never, principal("admin"))) base.registerTool(tool);
    const rules = readMainRules();
    rules.tool_rules.admin = [];
    rules.tool_rules.teacher = ["proposeClassMembership"];
    const admin = createChildRegistry(base, () => rules, principal("admin"));
    expect(admin.getTool("proposeClassMembership")).toBeDefined();
    expect(admin.getTool("proposeGovernance")).toBeUndefined();
  });
  it("教师规则误声明治理工具，不能绕过管理员自己的治理限制", () => {
    const base = createToolRegistry();
    for (const tool of createRoleActionTools({} as never, principal("admin"))) base.registerTool(tool);
    const rules = readMainRules();
    rules.tool_rules.admin = [];
    rules.tool_rules.teacher = ["proposeClassMembership", "proposeGovernance"];
    const admin = createChildRegistry(base, () => rules, principal("admin"));
    expect(admin.getTool("proposeClassMembership")).toBeDefined();
    expect(admin.getTool("proposeGovernance")).toBeUndefined();
  });
});
