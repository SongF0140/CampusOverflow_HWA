import { describe, expect, it, vi } from "vitest";
import { createInternalClient } from "../src/internal-client";
import { asTraceId } from "../src/types";
import { auditFetch } from "./helpers/audit-fetch";

describe("持久审计 HTTP 客户端", () => {
  it("按 POST/事件/PATCH 写入用户路径，凭证只进请求头", async () => {
    const serve = auditFetch(3);
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const response = await serve(input, init);
      if (!response) throw new Error("不应回退到服务路径");
      return response;
    });
    const client = createInternalClient({ baseUrl: "http://backend.test", token: "service-secret",
      authorization: "Bearer user-secret", fetchImpl });
    const trace = asTraceId("audit-trace");
    await client.audit.createRun({ agent_run_id: "run-test", task_type: "chat", input_summary: "任务元数据" }, trace);
    await client.audit.recordEvent("run-test", { event_type: "plan", plan_revision: 1, steps: [] }, trace);
    await client.audit.finishRun("run-test", { status: "succeeded" }, trace);
    expect(fetchImpl.mock.calls.map((call) => call[1]?.method)).toEqual(["POST", "POST", "PATCH"]);
    for (const [input, init] of fetchImpl.mock.calls) {
      expect(String(input)).toContain("/internal/agent/user/runs");
      const headers = new Headers(init?.headers);
      expect(headers.get("authorization")).toBe("Bearer user-secret");
      expect(headers.get("x-service-token")).toBe("service-secret");
      expect(headers.get("x-trace-id")).toBe("audit-trace");
      expect(headers.get("content-type")).toBe("application/json");
      expect(String(init?.body)).not.toMatch(/user-secret|service-secret/);
      expect(init?.redirect).toBe("error");
    }
  });
  it("异常或无效信封不能视为持久化成功，且不自动重试", async () => {
    const fetchImpl = vi.fn(async () => Response.json({ code: 200, data: {}, message: "ok" }));
    const client = createInternalClient({ baseUrl: "http://backend.test", token: "s", authorization: "Bearer u", fetchImpl });
    await expect(client.audit.createRun({ agent_run_id: "r", task_type: "chat", input_summary: "元数据" }, asTraceId("t"))).rejects.toThrow();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
