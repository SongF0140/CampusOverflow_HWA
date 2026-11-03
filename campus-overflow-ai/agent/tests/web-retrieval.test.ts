import { describe, expect, it, vi } from "vitest";
import { createWebTools } from "../src/web/tools.js";
import { createChildRegistry } from "../src/agents/controller.js";
import { readMainRules } from "../src/memory/main-context.js";
import { createToolRegistry } from "../src/tools/registry.js";
import type { AgentPrincipal } from "../src/auth/principal.js";
import type { AgentRunId, TraceId } from "../src/types/index.js";

const principal: AgentPrincipal = { user_id: 1, role: "student", status: "active", identity_type: "undergraduate", assistant_cert_status: "none" };
const context = { principal, agentRunId: "web-run" as AgentRunId, traceId: "web-trace" as TraceId };
const config = { enabled: true, browserEnabled: true, apiKey: "test-only-key" };
const source = { title: "参考资料", url: "https://example.com/article", content: "公开资料" };

describe("请求级网络工具", () => {
  it("未启用或无密钥时不展示工具", () => {
    expect(createWebTools(principal, { config: { ...config, enabled: false } })).toEqual([]);
    expect(createWebTools(principal, { config: { ...config, apiKey: "" } })).toEqual([]);
  });
  it("学生仅能使用已搜索来源且请求间不串用", async () => {
    const search = vi.fn(async () => [source]);
    const read = vi.fn(async () => ({ url: source.url, content: "正文" }));
    const first = createWebTools(principal, { config, search, read });
    const second = createWebTools(principal, { config, search, read });
    const firstRead = first.find(t => t.name === "readWebPage")!;
    await expect(firstRead.execute!({ url: source.url }, context)).rejects.toThrow();
    const result = await first.find(t => t.name === "searchWeb")!.execute!({ query: "公开知识" }, context);
    expect(result).toEqual({ kind: "external_web", sources: [source] });
    expect(await firstRead.execute!({ url: source.url }, context)).toMatchObject({ kind: "external_web", content: "正文" });
    await expect(second.find(t => t.name === "readWebPage")!.execute!({ url: source.url }, context)).rejects.toThrow();
    expect(read).toHaveBeenCalledTimes(1);
  });
  it("身份不匹配/失效拒绝，不把凭据字段交给适配器", async () => {
    const search = vi.fn(async () => [source]);
    const tool = createWebTools(principal, { config, search })[0];
    await expect(tool.execute!({ query: "公开知识" }, { ...context, principal: { ...principal, user_id: 2 } })).rejects.toThrow();
    await expect(tool.execute!({ query: "公开知识", api_key: "leak" }, context)).rejects.toThrow();
    expect(search).not.toHaveBeenCalled();
  });
  it("公开来源过滤内网/凭据URL", async () => {
    const tools = createWebTools(principal, { config, search: async () => [source, { ...source, url: "http://127.0.0.1/" }, { ...source, url: "https://a:b@example.com/" }] });
    expect(await tools[0].execute!({ query: "知识" }, context)).toEqual({ kind: "external_web", sources: [source] });
  });
  it("低风险工具需角色规则允许；收窄规则可撤权", () => {
    const base = createToolRegistry();
    for (const tool of createWebTools(principal, { config })) base.registerTool(tool);
    let rules = readMainRules();
    const child = createChildRegistry(base, () => rules, principal);
    expect(child.listTools().map(t => t.name)).toEqual(["searchWeb", "readWebPage"]);
    rules = { ...rules, tool_rules: { ...rules.tool_rules, student: [] } };
    expect(child.listTools()).toEqual([]);
  });
});
