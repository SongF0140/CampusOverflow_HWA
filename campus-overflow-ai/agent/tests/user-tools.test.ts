import { describe, expect, it, vi } from "vitest";

import { createInternalClient } from "../src/internal-client";
import { ensureBuiltinTools } from "../src/tools/index";
import { createToolRegistry } from "../src/tools/registry";
import { asAgentRunId, asTraceId } from "../src/types";

const context = { agentRunId: asAgentRunId("tools-user"), traceId: asTraceId("trace-user-tools") };

describe("请求级工具客户端", () => {
  it("拒绝格式非法的后端检索结果", async () => {
    const fetchImpl = vi.fn(async () => Response.json({
      code: 200, data: { items: [{ id: "not-an-id", name: 123 }], total: 1 }, message: "ok",
    }));
    const client = createInternalClient({
      baseUrl: "http://backend.test", token: "service", authorization: "Bearer alice", fetchImpl,
    });
    await expect(client.searchCourses({ keyword: "课程" }, context.traceId)).rejects.toThrow();
  });

  it("并发执行两个用户工具时凭证不串用，并使用后端蛇形课程过滤", async () => {
    const seen: string[] = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      const authorization = new Headers(init?.headers).get("authorization")!;
      seen.push(authorization);
      expect(url.pathname).toBe("/internal/agent/user/questions/search");
      expect(url.searchParams.get("course_id")).toBe("3");
      return Response.json({ code: 200, data: { items: [
        { id: authorization.endsWith("alice") ? 1 : 2, title: "TCP", course_id: 3 },
      ], total: 1 }, message: "ok" });
    });
    const toolsets = ["alice", "bob"].map((user) => {
      const registry = createToolRegistry();
      ensureBuiltinTools(createInternalClient({
        baseUrl: "http://backend.test", token: "service", authorization: `Bearer ${user}`, fetchImpl,
      }), registry);
      return registry.toSdkTools(context);
    });

    const results = await Promise.all(toolsets.map((tools, index) => tools.searchQuestions.execute!(
      { keyword: "TCP", courseId: 3 }, { toolCallId: `call-${index}`, messages: [] },
    )));

    expect(results).toEqual([
      [{ id: 1, title: "TCP", courseId: 3, status: undefined }],
      [{ id: 2, title: "TCP", courseId: 3, status: undefined }],
    ]);
    expect(seen.sort()).toEqual(["Bearer alice", "Bearer bob"]);
  });

  it("请求取消传播到身份解析和后续工具请求，不跟随重定向转交凭证", async () => {
    const abort = new AbortController();
    let captured: AbortSignal | null | undefined;
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      captured = init?.signal;
      expect(init?.redirect).toBe("error");
      return Response.json({ code: 200, data: { items: [], total: 0 }, message: "ok" });
    });
    const client = createInternalClient({
      baseUrl: "http://backend.test", token: "service", authorization: "Bearer alice",
      fetchImpl, signal: abort.signal,
    });
    await client.searchCourses({ keyword: "课程" }, context.traceId);
    expect(captured?.aborted).toBe(false);
    abort.abort();
    expect(captured?.aborted).toBe(true);
  });
});
