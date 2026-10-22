import { afterEach, describe, expect, it, vi } from "vitest";
import { MockLanguageModelV4 } from "ai/test";

import { createApp } from "../src/app";
import { createRunContext } from "../src/observability/run-context";
import { auditFetch } from "./helpers/audit-fetch";

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

const principal = (id: number) => ({
  user_id: id, role: "student", status: "active",
  identity_type: "undergraduate", assistant_cert_status: "none",
});
const envelope = (data: unknown) => Response.json({ code: 200, data, message: "ok" });
const tagsPlan = { steps: [{ stepId: "s1", objective: "读取词表", toolName: "fetchTags", args: { limit: 100 } }] };
const generated = (data: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(data) }],
  finishReason: { unified: "stop" as const, raw: undefined }, warnings: [],
  usage: { inputTokens: { total: 0, noCache: 0, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 0, text: 0, reasoning: 0 } },
});

describe("Agent 用户认证", () => {
  it("运行上下文只携带冻结的后端身份，剥离额外隐私字段且忽略自报角色", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => envelope({ ...principal(7), email: "private@example.com", token: "private-token" })));
    const app = createApp();
    app.get("/agent/context-probe", (c) => {
      const run = createRunContext({ taskType: "chat", principal: c.get("principal") });
      return c.json({ principal: run.principal, isFrozen: Object.isFrozen(run.principal) });
    });
    const response = await app.request("/agent/context-probe?user_id=999", {
      headers: { authorization: "Bearer user-secret", "x-role": "admin" },
    });
    expect(await response.json()).toEqual({ principal: principal(7), isFrozen: true });
  });

  it.each([401, 403])("检索时用户权限失效 %s 不能降级为纯文本建议", async (status) => {
    const auditResponse = auditFetch(7);
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (new URL(String(input)).pathname === "/internal/agent/principal") return envelope(principal(7));
      const response = await auditResponse(input, init);
      if (response) return response;
      return Response.json({ code: status, data: null, message: "权限已失效" }, { status });
    });
    vi.stubGlobal("fetch", fetchMock);
    const generate = vi.fn(async () => generated(tagsPlan));
    const model = new MockLanguageModelV4({ doGenerate: generate });
    const response = await createApp({ getModel: () => model }).request("/agent/tasks/suggest_tags", {
      method: "POST", headers: { authorization: "Bearer revoked-user" },
      body: JSON.stringify({ questionTitle: "死锁", questionBody: "进程死锁" }),
    });
    expect(response.status).toBe(status);
    expect(generate).toHaveBeenCalledTimes(1); // 只有计划生成，权限失效后不得生成结果。
  });

  it.each(["/agent/chat", "/agent/tasks/suggest_tags"])("%s 无凭证不能调用模型或内部接口", async (path) => {
    const getModel = vi.fn();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const response = await createApp({ getModel }).request(path, {
      method: "POST", body: JSON.stringify({ message: "你好" }),
    });
    expect(response.status).toBe(401);
    expect(getModel).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([401, 403])("后端身份拒绝 %s 时不调用模型、不创建运行记录", async (status) => {
    const getModel = vi.fn();
    const fetchMock = vi.fn(async () => Response.json({ code: status, data: null, message: "拒绝" }, { status }));
    vi.stubGlobal("fetch", fetchMock);
    const response = await createApp({ getModel }).request("/agent/chat", {
      method: "POST", headers: { authorization: "Bearer user-secret", "x-trace-id": "auth-rejected" },
      body: JSON.stringify({ message: "你好" }),
    });
    expect(response.status).toBe(status);
    expect(getModel).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("后端异常返回脱敏 503，不暴露凭证或降级成服务身份", async () => {
    const getModel = vi.fn();
    const fetchMock = vi.fn(async () => { throw new Error("Bearer user-secret"); });
    vi.stubGlobal("fetch", fetchMock);
    const response = await createApp({ getModel }).request("/agent/chat", {
      method: "POST", headers: { authorization: "Bearer user-secret" }, body: "{}",
    });
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("user-secret");
    expect(getModel).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("默认启动验证身份后以相同凭证和 trace 检索词表，伪造角色无效", async () => {
    vi.stubEnv("AGENT_SERVICE_TOKEN", "service-test-secret");
    const auditResponse = auditFetch(7);
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      const headers = new Headers(init?.headers);
      expect(headers.get("authorization")).toBe("Bearer user-secret");
      expect(headers.get("x-service-token")).toBe("service-test-secret");
      expect(headers.get("x-trace-id")).toBe("auth-success");
      if (url.pathname === "/internal/agent/principal") return envelope(principal(7));
      const response = await auditResponse(input, init);
      if (response) return response;
      expect(url.pathname).toBe("/internal/agent/user/tags");
      return envelope({ items: [{ id: 11, name: "操作系统", type: "tech" }], total: 1 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const outputs = [tagsPlan, { tags: [{ name: "操作系统", reason: "主题相关", confidence: 0.9 }] }];
    const generate = vi.fn(async () => generated(outputs.shift()));
    const model = new MockLanguageModelV4({ doGenerate: generate });
    const response = await createApp({ getModel: () => model }).request("/agent/tasks/suggest_tags", {
      method: "POST", headers: { authorization: "Bearer user-secret", "x-trace-id": "auth-success", "x-role": "admin" },
      body: JSON.stringify({ questionTitle: "死锁", questionBody: "进程死锁" }),
    });
    expect(response.status).toBe(200);
    expect((await response.json()).data.tags[0].tagId).toBe(11);
    expect(fetchMock).toHaveBeenCalledTimes(7);
    expect(JSON.stringify(model.doGenerateCalls)).not.toContain("user-secret");
    expect(JSON.stringify(model.doGenerateCalls)).not.toContain("service-test-secret");
  });

  it.each([{}, { ...principal(7), role: "superadmin" }, { ...principal(7), status: "banned" }])(
    "身份响应格式非法时拒绝执行", async (data) => {
      vi.stubGlobal("fetch", vi.fn(async () => envelope(data)));
      const getModel = vi.fn();
      const response = await createApp({ getModel }).request("/agent/chat", {
        method: "POST", headers: { authorization: "Bearer user-secret" }, body: "{}",
      });
      expect(response.status).toBe(503);
      expect(getModel).not.toHaveBeenCalled();
    },
  );
});
