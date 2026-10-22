import { afterEach, describe, expect, it, vi } from "vitest";
import { MockLanguageModelV4, simulateReadableStream } from "ai/test";

import { createApp } from "../src/app";
import { auditStub } from "./helpers/audit-stub";

afterEach(() => vi.restoreAllMocks());
const usage = { inputTokens: { total: 0, noCache: 0, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 0, text: 0, reasoning: 0 } };

type FinishReason = "stop" | "length" | "content-filter" | "error" | "other" | "tool-calls";
function fixture(options: { generateReason?: FinishReason; generateAt?: number;
  streamReason?: FinishReason; streamError?: boolean; emptyGenerate?: boolean;
  malformedGenerate?: boolean; missingFinish?: boolean } = {}) {
  const audit = auditStub();
  const first = { steps: [1, 2].map((i) => ({ stepId: `s${i}`, objective: "private-objective",
    toolName: "fetchTags", args: { limit: 5 } })) };
  const outputs = [first, { tags: [{ name: "并发", reason: "private-output", confidence: 0.8 }] }];
  let generated = 0;
  const generate = vi.fn(async () => {
    const text = JSON.stringify(outputs.shift());
    const isTarget = ++generated === (options.generateAt ?? 1);
    return { content: isTarget && options.emptyGenerate ? [] : [{ type: "text" as const,
      text: isTarget && options.malformedGenerate ? '{"steps":' : text }],
      finishReason: { unified: isTarget ? options.generateReason ?? "stop" : "stop" as const,
        raw: undefined }, usage, warnings: [] };
  });
  const stream = vi.fn(async () => ({ stream: simulateReadableStream({ chunks: [
    { type: "stream-start", warnings: [] }, { type: "text-start", id: "t" },
    { type: "text-delta", id: "t", delta: "建议" }, { type: "text-end", id: "t" },
    ...(options.streamError ? [{ type: "error" as const, error: new Error("private-provider-secret") }] : []),
    ...(options.missingFinish ? [] : [{ type: "finish" as const,
      finishReason: { unified: options.streamReason ?? "stop", raw: undefined }, usage }]),
  ] }) }));
  const client = { audit,
    resolvePrincipal: vi.fn().mockResolvedValue({ user_id: 3, role: "student", status: "active",
      identity_type: "undergraduate", assistant_cert_status: "none" }),
    fetchTags: vi.fn().mockResolvedValue([{ id: 7, name: "private-body", type: "tech" }]),
    searchCourses: vi.fn(), searchQuestions: vi.fn(), fetchModerationTarget: vi.fn(),
  };
  const model = new MockLanguageModelV4({ doGenerate: generate, doStream: stream });
  const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
  const app = createApp({ getModel: () => model, createClient: () => client });
  const request = (chat = false) => app.request(chat ? "/agent/chat" : "/agent/tasks/suggest_tags", {
    method: "POST", headers: { authorization: "Bearer user-secret", "x-trace-id": "trace-audit" },
    body: JSON.stringify(chat ? { message: "private-input" } : { questionTitle: "private-input", questionBody: "private-input" }),
  });
  return { audit, generate, stream, client, request, errorLog };
}

describe("生产请求持久审计", () => {
  it.each<FinishReason>(["length", "content-filter", "error", "other", "tool-calls"])(
    "聊天以 %s 结束时只发送失败，持久化 failed", async (streamReason) => {
      const f = fixture({ streamReason });
      const body = await (await f.request(true)).text();
      expect(body).toContain("event: error");
      expect(body).not.toContain("event: done");
      expect(f.audit.finishRun).toHaveBeenCalledExactlyOnceWith(expect.any(String),
        expect.objectContaining({ status: "failed" }), "trace-audit");
    });

  it("聊天先收到错误事件，随后 stop 也不能成功或泄露提供商错误", async () => {
    const f = fixture({ streamError: true });
    const body = await (await f.request(true)).text();
    expect(body).toContain("event: error");
    expect(body).not.toContain("event: done");
    expect(body).not.toContain("private-provider-secret");
    expect(JSON.stringify(f.errorLog.mock.calls)).not.toContain("private-provider-secret");
    expect(f.audit.finishRun).toHaveBeenCalledWith(expect.any(String),
      expect.objectContaining({ status: "failed" }), "trace-audit");
  });

  it.each<FinishReason>(["length", "content-filter", "error", "other", "tool-calls"])(
    "计划 JSON 合法但以 %s 结束时不执行工具、不自动重试", async (generateReason) => {
      const f = fixture({ generateReason });
      const response = await f.request();
      expect(response.status).toBe(500);
      expect(f.generate).toHaveBeenCalledOnce();
      expect(f.client.fetchTags).not.toHaveBeenCalled();
      expect(f.audit.recordEvent).not.toHaveBeenCalled();
      expect(f.audit.finishRun).toHaveBeenCalledWith(expect.any(String),
        expect.objectContaining({ status: "failed" }), "trace-audit");
    });

  it("无结构化文本的异常结束也不自动重试", async () => {
    const f = fixture({ generateReason: "length", emptyGenerate: true });
    expect((await f.request()).status).toBe(500);
    expect(f.generate).toHaveBeenCalledOnce();
    expect(f.client.fetchTags).not.toHaveBeenCalled();
  });

  it("JSON 损坏且长度截断不能被当成结构错误自动重试", async () => {
    const f = fixture({ generateReason: "length", malformedGenerate: true });
    expect((await f.request()).status).toBe(500);
    expect(f.generate).toHaveBeenCalledOnce();
    expect(f.client.fetchTags).not.toHaveBeenCalled();
  });

  it("聊天流缺少结束帧不能报成功", async () => {
    const f = fixture({ missingFinish: true });
    const body = await (await f.request(true)).text();
    expect(body).toContain("event: error");
    expect(body).not.toContain("event: done");
    expect(f.audit.finishRun).toHaveBeenCalledWith(expect.any(String),
      expect.objectContaining({ status: "failed" }), "trace-audit");
  });

  it("最终建议 JSON 合法但长度截断仍失败，不返回建议", async () => {
    const f = fixture({ generateReason: "length", generateAt: 2 });
    const response = await f.request();
    expect(response.status).toBe(500);
    const body = await response.text();
    expect(body).not.toContain("private-output");
    expect(body).toContain("trace-audit");
    expect(f.generate).toHaveBeenCalledTimes(2);
    expect(f.audit.finishRun).toHaveBeenCalledWith(expect.any(String),
      expect.objectContaining({ status: "failed" }), "trace-audit");
  });

  it("聊天正常结束且终态写入成功才发 done", async () => {
    const f = fixture();
    const body = await (await f.request(true)).text();
    expect(body).toContain("event: delta");
    expect(body).toContain("event: done");
    expect(body).not.toContain("event: error");
    expect(f.audit.finishRun).toHaveBeenCalledExactlyOnceWith(expect.any(String),
      expect.objectContaining({ status: "succeeded" }), "trace-audit");
  });
  it.each(["create", "step_started", "step_succeeded"])("等待 %s 写入后才继续", async (phase) => {
    const f = fixture();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    if (phase === "create") {
      const original = f.audit.createRun.getMockImplementation()!;
      f.audit.createRun.mockImplementation(async (...args) => { await gate; return original(...args); });
    } else {
      const original = f.audit.recordEvent.getMockImplementation()!;
      let held = false;
      f.audit.recordEvent.mockImplementation(async (...args) => {
        if (!held && args[1].event_type === phase) { held = true; await gate; }
        return original(...args);
      });
    }
    const pending = f.request();
    try {
      await vi.waitFor(() => {
        if (phase === "create") expect(f.audit.createRun).toHaveBeenCalledOnce();
        else expect(f.audit.recordEvent.mock.calls.some((call) => call[1].event_type === phase)).toBe(true);
      });
      expect(f.generate).toHaveBeenCalledTimes(phase === "create" ? 0 : 1);
      expect(f.client.fetchTags).toHaveBeenCalledTimes(phase === "step_succeeded" ? 1 : 0);
    } finally { release(); }
    expect((await pending).status).toBe(200);
  });
  it("创建运行、保存计划与步骤后才生成结果，记录不含原文", async () => {
    const f = fixture();
    const response = await f.request();
    expect(response.status).toBe(200);
    expect(f.audit.createRun).toHaveBeenCalledOnce();
    expect(f.audit.recordEvent.mock.calls.map((call) => call[1].event_type)).toEqual([
      "plan", "step_started", "step_succeeded", "step_started", "step_succeeded",
    ]);
    expect(f.audit.finishRun).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ status: "succeeded" }), "trace-audit");
    const recorded = JSON.stringify([f.audit.createRun.mock.calls, f.audit.recordEvent.mock.calls, f.audit.finishRun.mock.calls]);
    for (const secret of ["private-input", "private-body", "private-output", "private-objective", "user-secret"]) {
      expect(recorded).not.toContain(secret);
    }
  });

  it("创建失败不会进入模型或工具，响应保留追踪信息", async () => {
    const f = fixture();
    f.audit.createRun.mockRejectedValue(new Error("token=private-secret"));
    const response = await f.request();
    expect(response.status).toBe(503);
    expect(await response.text()).toContain("trace-audit");
    expect(f.generate).not.toHaveBeenCalled();
    expect(f.client.fetchTags).not.toHaveBeenCalled();
    expect(f.audit.finishRun).not.toHaveBeenCalled();
    expect(JSON.stringify(f.errorLog.mock.calls)).not.toContain("private-secret");
  });

  it.each(["plan", "step_started", "step_succeeded"])("%s 记录失败不能被降级或继续下一步", async (kind) => {
    const f = fixture();
    const record = f.audit.recordEvent.getMockImplementation()!;
    f.audit.recordEvent.mockImplementation(async (...args) => {
      if (args[1].event_type === kind) throw new Error("private-secret");
      return record(...args);
    });
    const response = await f.request();
    expect(response.status).toBe(503);
    expect(f.generate).toHaveBeenCalledTimes(1);
    expect(f.client.fetchTags).toHaveBeenCalledTimes(kind === "step_succeeded" ? 1 : 0);
    expect(f.audit.finishRun).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ status: "failed" }), "trace-audit");
  });

  it("普通工具故障记录失败状态，仍可按任务约定降级", async () => {
    const f = fixture();
    f.client.fetchTags.mockRejectedValue(new Error("private-backend-body"));
    expect((await f.request()).status).toBe(200);
    expect(f.audit.recordEvent.mock.calls.map((call) => call[1].event_type)).toContain("step_failed");
    expect(JSON.stringify(f.audit.recordEvent.mock.calls)).not.toContain("private-backend-body");
  });

  it("失败工具的审计写入失败也不能进入降级生成", async () => {
    const f = fixture();
    f.client.fetchTags.mockRejectedValue(new Error("private-body"));
    const original = f.audit.recordEvent.getMockImplementation()!;
    f.audit.recordEvent.mockImplementation(async (...args) => {
      if (args[1].event_type === "step_failed") throw new Error("audit-down");
      return original(...args);
    });
    expect((await f.request()).status).toBe(503);
    expect(f.client.fetchTags).toHaveBeenCalledTimes(1);
    expect(f.generate).toHaveBeenCalledTimes(1);
  });

  it.each([false, true])("终态审计失败不返回成功或 SSE done（chat=%s）", async (chat) => {
    const f = fixture();
    f.audit.finishRun.mockRejectedValue(new Error("private-secret"));
    const response = await f.request(chat);
    const body = await response.text();
    if (chat) {
      expect(body).toContain("event: error");
      expect(body).not.toContain("event: done");
    } else expect(response.status).toBe(503);
    expect(f.audit.finishRun).toHaveBeenCalledTimes(1);
    expect(body).not.toContain("private-secret");
    expect(JSON.stringify(f.errorLog.mock.calls)).toContain("trace-audit");
  });

  it.each(["user_id", "trace_id", "agent_run_id"])("拒绝后端错配的运行 %s", async (field) => {
    const f = fixture();
    const original = f.audit.createRun.getMockImplementation()!;
    f.audit.createRun.mockImplementation(async (...args) => {
      const data = await original(...args);
      if (field === "user_id") return { ...data, user_id: 999 };
      if (field === "trace_id") return { ...data, trace_id: "wrong-trace" };
      return { ...data, agent_run_id: "wrong-run" };
    });
    expect((await f.request()).status).toBe(503);
    expect(f.generate).not.toHaveBeenCalled();
  });
});
