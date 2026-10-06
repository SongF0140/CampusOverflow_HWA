import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { createInternalClient, InternalApiError, type InternalClient } from "../src/internal-client";
import { assertToolAllowed, getTool, registerTool, toSdkTools } from "../src/tools/registry";
import { asAgentRunId, asTraceId } from "../src/types";

// 本文件使用独立工具名，避免与其他测试文件的模块级注册表冲突
const ctx = { agentRunId: asAgentRunId("run-tools-1"), traceId: asTraceId("trace-tools-1") };

describe("tool whitelist guard", () => {
  it("rejects tools that are not registered", () => {
    expect(() => assertToolAllowed("never-registered-tool")).toThrow("tool not whitelisted");
  });

  it("rejects non-low risk tools without approval flow", () => {
    registerTool({
      name: "deleteContentTool",
      description: "仅类型位：删帖属高风险，须经 T-15 审批工单",
      riskLevel: "high",
    });
    expect(() => assertToolAllowed("deleteContentTool")).toThrow("requires approval flow");
    expect(getTool("deleteContentTool")).toBeDefined();
  });
});

describe("sdk toolset conversion", () => {
  it("includes executable low-risk tools and excludes metadata-only tools", () => {
    registerTool({
      name: "metadataOnlyTool",
      description: "仅登记元信息，不提供执行通道",
      riskLevel: "medium",
    });
    const toolSet = toSdkTools(ctx);
    expect(toolSet.metadataOnlyTool).toBeUndefined();
  });
});

describe("internal client", () => {
  it("sends service token and x-trace-id, unwraps unified envelope", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ code: 200, data: { items: [{ id: 7, name: "操作系统" }], total: 1 }, message: "ok" }),
        { status: 200 },
      ),
    );
    const client = createInternalClient({ baseUrl: "http://backend.test", token: "svc-token", fetchImpl });
    const courses = await client.searchCourses({ keyword: "操作", limit: 5 }, asTraceId("trace-abc"));

    expect(courses).toEqual([{ id: 7, name: "操作系统" }]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://backend.test/internal/agent/courses/search?keyword=%E6%93%8D%E4%BD%9C&limit=5");
    const headers = new Headers(init.headers);
    expect(headers.get("Authorization")).toBe("Bearer svc-token");
    expect(headers.get("x-trace-id")).toBe("trace-abc");
  });

  it("propagates question search params and raises InternalApiError on failure", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ code: 200, data: { items: [], total: 0 }, message: "ok" }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ code: 401, data: null, message: "未授权" }), { status: 401 }),
      );
    const client: InternalClient = createInternalClient({
      baseUrl: "http://backend.test/",
      token: "svc-token",
      fetchImpl,
    });

    await client.searchQuestions({ keyword: "死锁", courseId: 3, tags: ["os", "进程"], limit: 5 }, asTraceId("t"));
    const [url] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("keyword=%E6%AD%BB%E9%94%81");
    expect(url).toContain("courseId=3");
    expect(url).toContain("tags=os%2C%E8%BF%9B%E7%A8%8B");

    await expect(
      client.searchQuestions({ keyword: "x" }, asTraceId("t")),
    ).rejects.toBeInstanceOf(InternalApiError);
  });
});
