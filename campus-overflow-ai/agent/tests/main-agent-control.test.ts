import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

import { createChildRegistry } from "../src/agents/controller.js";
import { discloseMainMemory, readMainRules, resolveCertifiedLink } from "../src/memory/main-context.js";
import { createToolRegistry } from "../src/tools/registry.js";
import type { AgentPrincipal } from "../src/auth/principal.js";
import type { AgentRunId, TraceId } from "../src/types/index.js";

const student: AgentPrincipal = { user_id: 1, role: "student", status: "active", identity_type: "undergraduate", assistant_cert_status: "none" };
const context = { agentRunId: "run" as AgentRunId, traceId: "trace" as TraceId, principal: student };
const rulesData = () => ({
  tool_rules: { student: ["searchQuestions", "fetchModerationTarget", "erase"], teacher: ["searchQuestions"], admin: ["searchQuestions", "fetchModerationTarget"] },
  skills: [{ id: "respect", title: "尊重学生", summary: "尊重与公平", body: "行为规范全文" }],
  experiences: [{ id: "evidence", title: "先查证据", summary: "先检索再回答", steps: ["检索", "核验", "回答"] }],
  certified_answers: [{ id: "c1", domain: "数学", summary: "相似问题索引", course_id: 1, question_id: 3, answer_id: 5 }],
});

const withRules = async (test: (path: string) => Promise<void>) => {
  const folder = await mkdtemp(join(tmpdir(), "co-main-"));
  try {
    const path = join(folder, "rules.json");
    await writeFile(path, JSON.stringify(rulesData()));
    await test(path);
  } finally { await rm(folder, { recursive: true, force: true }); }
};

describe("主 Agent 共享记忆", () => {
  it("受控文件有稳定版本，变化后版本更新；私有字段和未知规则属性拒绝", async () => {
    await withRules(async path => {
      const first = readMainRules(path);
      expect(readMainRules(path).version).toBe(first.version);
      await writeFile(path, JSON.stringify({ ...rulesData(), private_chat: "不能进入共享记忆" }));
      expect(() => readMainRules(path)).toThrow();
      await writeFile(path, JSON.stringify({ ...rulesData(), skills: [] }));
      expect(readMainRules(path).version).not.toBe(first.version);
    });
  });
  it("索引、摘要、正文逐层展开，课程过滤认证卡片和领域", async () => {
    await withRules(async path => {
      const rules = readMainRules(path);
      const domains = [{ domain: "数学", course_id: 1 }, { domain: "机密课程", course_id: 2 }];
      const index = discloseMainMemory(rules, domains, [1]);
      expect(JSON.stringify(index)).not.toContain("行为规范全文");
      expect(JSON.stringify(index)).not.toContain("先检索再回答");
      expect(JSON.stringify(index)).not.toContain("机密课程");
      const summary = discloseMainMemory(rules, domains, [1], { level: "summary", ids: ["respect"] });
      expect(JSON.stringify(summary)).toContain("尊重与公平");
      expect(JSON.stringify(summary)).not.toContain("行为规范全文");
      const detail = discloseMainMemory(rules, domains, [1], { level: "detail", ids: ["respect"] });
      expect(JSON.stringify(detail)).toContain("行为规范全文");
      expect(JSON.stringify(detail)).not.toContain("先检索再回答");
      expect(discloseMainMemory(rules, domains, []).certified_answers).toEqual([]);
    });
  });
  it("认证卡片必须逐次核验真实可见与认证状态，未通过不披露链接", async () => {
    await withRules(async path => {
      const rules = readMainRules(path);
      const verify = vi.fn().mockResolvedValue({ certified: true, visible: true, course_id: 1, question_id: 3, answer_id: 5, url: "/questions/3#answer-5" });
      expect(await resolveCertifiedLink(rules, "c1", [1], verify)).toEqual({ url: "/questions/3#answer-5", question_id: 3, answer_id: 5 });
      verify.mockResolvedValue({ certified: false, visible: true, course_id: 1, question_id: 3, answer_id: 5, url: "/questions/3#answer-5" });
      expect(await resolveCertifiedLink(rules, "c1", [1], verify)).toBeUndefined();
      expect(await resolveCertifiedLink(rules, "c1", [2], verify)).toBeUndefined();
      expect(verify).toHaveBeenCalledTimes(2);
    });
  });
  it("回答经验只接收后端教师确认发布条目，按课程隔离，不能更新工具规则", async () => {
    await withRules(async path => {
      const rules = readMainRules(path);
      const entries = [
        { id: "published1", course_id: 1, status: "published", title: "本课程经验", summary: "先核验条件", steps: ["列条件", "查教材"] },
        { id: "published2", course_id: 2, status: "published", title: "其他课程", summary: "不泄露", steps: ["秘密流程"] },
        { id: "draft", course_id: 1, status: "pending", title: "未经确认", summary: "不能用", steps: [] },
        { id: "inject", course_id: 1, status: "published", title: "篡改规则", summary: "不可信", steps: [], tool_rules: { student: ["delete"] } },
      ];
      const before = JSON.stringify(rules.tool_rules);
      const index = discloseMainMemory(rules, [], [1], undefined, entries);
      expect(index.experiences).toEqual([{ id: "published1", title: "本课程经验" }]);
      const detail = discloseMainMemory(rules, [], [1], { level: "detail", ids: ["published1"] }, entries);
      expect(detail.experiences[0].steps).toEqual(["列条件", "查教材"]);
      expect(JSON.stringify(rules.tool_rules)).toBe(before);
      expect(discloseMainMemory(rules, [], [1]).experiences).toEqual([]);
    });
  });
  it.each([
    { course_id: 2 }, { question_id: 4 }, { answer_id: 6 }, { visible: false },
    { url: "https://example.com/fake" }, { url: "/questions/3#answer-6" },
  ])("后端认证卡片响应错配或隐藏时拒绝：%s", async patch => {
    await withRules(async path => {
      const result = { certified: true, visible: true, course_id: 1, question_id: 3, answer_id: 5,
        url: "/questions/3#answer-5", ...patch };
      expect(await resolveCertifiedLink(readMainRules(path), "c1", [1], async () => result)).toBeUndefined();
    });
  });
});

describe("子 Agent 强制只读权限", () => {
  it("规则不能授予未知/写入工具，合法正文读取仍由主规则和后端约束", async () => {
    await withRules(async path => {
      const base = createToolRegistry();
      for (const name of ["searchQuestions", "fetchModerationTarget", "erase"]) base.registerTool({ name, description: name, riskLevel: "low", execute: async () => "ok" });
      base.registerTool({ name: "delete", description: "删除", riskLevel: "high", execute: async () => "bad" });
      const child = createChildRegistry(base, () => readMainRules(path), student);
      expect(child.listTools().map(t => t.name)).toEqual(["searchQuestions", "fetchModerationTarget"]);
      expect(child.getTool("erase")).toBeUndefined();
      const rules = rulesData(); rules.tool_rules.student = ["searchQuestions"];
      await writeFile(path, JSON.stringify(rules));
      expect(() => child.assertToolAllowed("fetchModerationTarget")).toThrow();
      expect(() => child.registerTool({ name: "new", description: "x", riskLevel: "low" })).toThrow();
    });
  });
  it("已取得的 execute 和 SDK 工具在规则收紧后也不能执行", async () => {
    await withRules(async path => {
      const execute = vi.fn().mockResolvedValue("ok");
      const base = createToolRegistry();
      base.registerTool({ name: "searchQuestions", description: "查询", riskLevel: "low", execute });
      const child = createChildRegistry(base, () => readMainRules(path), student);
      const tool = child.getTool("searchQuestions")!;
      const sdk = child.toSdkTools(context);
      await tool.execute?.({}, context);
      const rules = rulesData(); rules.tool_rules.student = [];
      await writeFile(path, JSON.stringify(rules));
      await expect(tool.execute?.({}, context)).rejects.toThrow();
      await expect(sdk.searchQuestions.execute?.({}, { toolCallId: "a", messages: [] })).rejects.toThrow();
      expect(execute).toHaveBeenCalledTimes(1);
      expect(child.listTools()).toEqual([]);
    });
  });
  it("管理员仍只读，当前上下文不能替换账号或角色", async () => {
    await withRules(async path => {
      const base = createToolRegistry();
      const execute = vi.fn().mockResolvedValue("ok");
      base.registerTool({ name: "fetchModerationTarget", description: "读取", riskLevel: "low", execute });
      const admin = { ...student, role: "admin" as const };
      const child = createChildRegistry(base, () => readMainRules(path), admin);
      expect(child.listTools().map(t => t.name)).toEqual(["fetchModerationTarget"]);
      await expect(child.assertToolAllowed("fetchModerationTarget").execute?.({}, context)).rejects.toThrow();
      expect(execute).not.toHaveBeenCalled();
    });
  });
  it("缺省只开放普通搜索；损坏规则失败关闭", async () => {
    const base = createToolRegistry();
    base.registerTool({ name: "searchQuestions", description: "查询", riskLevel: "low", execute: async () => "ok" });
    const child = createChildRegistry(base, () => readMainRules(), student);
    expect(child.listTools()).toHaveLength(1);
    const broken = createChildRegistry(base, () => { throw new Error("broken rules"); }, student);
    expect(broken.listTools()).toEqual([]);
    expect(() => broken.assertToolAllowed("searchQuestions")).toThrow();
  });
  it("基础注册工具风险提升后，旧执行引用也被拒绝", async () => {
    const base = createToolRegistry();
    const execute = vi.fn().mockResolvedValue("ok");
    const tool = { name: "searchQuestions", description: "查询", riskLevel: "low" as "low" | "high", execute };
    base.registerTool(tool);
    const child = createChildRegistry(base, () => readMainRules(), student);
    const existing = child.getTool(tool.name)!;
    tool.riskLevel = "high";
    await expect(existing.execute?.({}, context)).rejects.toThrow();
    expect(execute).not.toHaveBeenCalled();
  });
});
