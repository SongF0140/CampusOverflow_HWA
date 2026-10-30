import { afterEach, describe, expect, it, vi } from "vitest";
import { MockLanguageModelV4 } from "ai/test";
import { SSEStreamingApi } from "hono/streaming";

import { createApp } from "../src/app";
import { createInternalClient } from "../src/internal-client";
import { auditFetch } from "./helpers/audit-fetch";
import { approvedReview } from "./helpers/review-response";

const usage = { inputTokens: { total: 0, noCache: 0, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 0, text: 0, reasoning: 0 } };
const plan = { steps: [1, 2].map((i) => ({ stepId: `s${i}`, objective: "读取词表",
  toolName: "fetchTags", args: { limit: 5 } })) };
const generated = (data: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(data) }],
  finishReason: { unified: "stop" as const, raw: undefined }, usage, warnings: [] });
const envelope = (data: unknown) => Response.json({ code: 200, data, message: "ok" });
const tags = () => envelope({ items: [{ id: 7, name: "并发", type: "tech" }], total: 1 });
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
};
const flush = async () => { for (let i = 0; i < 300; i++) await Promise.resolve(); };

function fixture() {
  vi.useFakeTimers();
  const controller = new AbortController();
  const serveAudit = auditFetch(3);
  const read = vi.fn(async (_signal?: AbortSignal | null) => tags());
  const finish = vi.fn<() => Promise<Response | undefined>>(async () => undefined);
  const beforeStep = vi.fn<() => Promise<void>>(async () => undefined);
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = new URL(String(input)).pathname;
    if (path.endsWith("/principal")) return envelope({ user_id: 3, role: "student", status: "active",
      identity_type: "undergraduate", assistant_cert_status: "none" });
    if (path.endsWith("/tags")) return read(init?.signal);
    if (init?.method === "PATCH") { const result = await finish(); if (result) return result; }
    if (path.endsWith("/events") && JSON.parse(String(init?.body)).event_type === "step_started") await beforeStep();
    const result = await serveAudit(input, init);
    if (!result) throw new Error("禁止非白名单路径");
    return result;
  });
  const modelSignals: Array<AbortSignal | undefined> = [];
  let count = 0;
  const generate = vi.fn(async (options: Parameters<MockLanguageModelV4["doGenerate"]>[0]) => {
    const review = approvedReview(options);
    if (review) return review;
    modelSignals.push(options.abortSignal);
    return generated(count++ === 0 ? plan : { tags: [{ name: "并发", reason: "建议", confidence: 0.8 }] });
  });
  const streamSignals: Array<AbortSignal | undefined> = [];
  const stream = vi.fn(async (options: Parameters<MockLanguageModelV4["doStream"]>[0]) => {
    streamSignals.push(options.abortSignal);
    return { stream: new ReadableStream({ start(output) {
      output.enqueue({ type: "stream-start", warnings: [] });
      output.enqueue({ type: "text-start", id: "t" });
      output.enqueue({ type: "text-delta", id: "t", delta: "未完成片段" });
    } }) };
  });
  const model = new MockLanguageModelV4({ doGenerate: generate, doStream: stream });
  let clientSignal!: AbortSignal;
  const app = createApp({ getModel: () => model, createClient: (authorization, signal) => {
    clientSignal = signal;
    return createInternalClient({ baseUrl: "http://backend.test", token: "service-secret",
      authorization, signal, fetchImpl });
  } });
  const request = (chat = false) => app.request(chat ? "/agent/chat" : "/agent/tasks/suggest_tags", {
    method: "POST", headers: { authorization: "Bearer user-secret", "x-trace-id": "trace-stop" },
    signal: controller.signal,
    body: JSON.stringify(chat ? { message: "课程问题" } : { questionTitle: "并发", questionBody: "线程问题" }),
  });
  const patches = () => fetchImpl.mock.calls.filter((call) => call[1]?.method === "PATCH");
  const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
  return { controller, read, generate, stream, modelSignals, streamSignals, beforeStep, finish,
    request, patches, errorLog, get clientSignal() { return clientSignal; } };
}

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe("运行超时与取消", () => {
  it("规划等待中取消不重试，迟到计划不能执行工具", async () => {
    const f = fixture();
    const gate = deferred<ReturnType<typeof generated>>();
    let signal: AbortSignal | undefined;
    f.generate.mockImplementationOnce(async (options) => { signal = options.abortSignal; return gate.promise; });
    const pending = f.request();
    await flush();
    expect(f.generate).toHaveBeenCalledOnce();
    f.controller.abort(new Error("private-cancel-reason"));
    await flush();
    expect(signal?.aborted).toBe(true);
    const response = await pending;
    expect(response.status).toBe(408);
    expect(await response.text()).not.toContain("private-cancel-reason");
    gate.resolve(generated(plan));
    await flush();
    expect(f.generate).toHaveBeenCalledOnce();
    expect(f.read).not.toHaveBeenCalled();
    expect(JSON.parse(String(f.patches()[0][1]?.body))).toMatchObject({ status: "failed", error_summary: "任务已取消" });
  });

  it("工具等待中取消阻止降级和下一步，失败终态使用独立信号与原凭证", async () => {
    const f = fixture();
    const gate = deferred<Response>();
    f.read.mockImplementationOnce(async () => gate.promise);
    const pending = f.request();
    await flush();
    expect(f.read).toHaveBeenCalledOnce();
    f.controller.abort();
    await flush();
    expect((await pending).status).toBe(408);
    expect(f.read.mock.calls[0][0]?.aborted).toBe(true);
    expect(f.generate).toHaveBeenCalledOnce();
    expect(f.patches()).toHaveLength(1);
    const init = f.patches()[0][1]!;
    expect(init.signal?.aborted).toBe(false);
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer user-secret");
    expect(new Headers(init.headers).get("x-service-token")).toBe("service-secret");
    gate.resolve(tags());
    await flush();
    expect(f.read).toHaveBeenCalledOnce();
    expect(f.patches()).toHaveLength(1);
  });

  it("等待调用准备审计时取消，审计迟到后也不能发出工具", async () => {
    const f = fixture();
    const gate = deferred<void>();
    f.beforeStep.mockImplementationOnce(async () => gate.promise);
    const pending = f.request();
    await flush();
    expect(f.beforeStep).toHaveBeenCalledOnce();
    f.controller.abort();
    await flush();
    expect((await pending).status).toBe(408);
    gate.resolve();
    await flush();
    expect(f.read).not.toHaveBeenCalled();
    expect(f.generate).toHaveBeenCalledOnce();
  });

  it("模型单次等待 60 秒超时且不自动重试", async () => {
    const f = fixture();
    const gate = deferred<ReturnType<typeof generated>>();
    let signal: AbortSignal | undefined;
    f.generate.mockImplementationOnce(async (options) => { signal = options.abortSignal; return gate.promise; });
    const pending = f.request();
    await flush();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(signal?.aborted).toBe(true);
    expect((await pending).status).toBe(504);
    expect(f.generate).toHaveBeenCalledOnce();
    expect(f.read).not.toHaveBeenCalled();
    expect(JSON.parse(String(f.patches()[0][1]?.body))).toMatchObject({ error_summary: "上游请求超时" });
  });

  it("后端响应体卡住也在 60 秒停止，不进入标签降级生成", async () => {
    const f = fixture();
    f.read.mockResolvedValueOnce(new Response(new ReadableStream({ start(output) { output.enqueue(new TextEncoder().encode('{"code":')); } })));
    const pending = f.request();
    await flush();
    await vi.advanceTimersByTimeAsync(60_000);
    expect((await pending).status).toBe(504);
    expect(f.generate).toHaveBeenCalledOnce();
    expect(f.read).toHaveBeenCalledOnce();
  });

  it("最终结构化生成等待中取消也不重试或返回建议", async () => {
    const f = fixture();
    const gate = deferred<ReturnType<typeof generated>>();
    const started = deferred<void>();
    const original = f.generate.getMockImplementation()!;
    let signal: AbortSignal | undefined;
    f.generate.mockImplementationOnce(original).mockImplementationOnce(async (options) => {
      signal = options.abortSignal;
      started.resolve(undefined);
      return gate.promise;
    });
    const pending = f.request();
    // 等待真实阶段信号，不依赖不同Node版本的微任务调度次数。
    await started.promise;
    expect(f.generate).toHaveBeenCalledTimes(2);
    f.controller.abort();
    await flush();
    const response = await pending;
    expect(response.status).toBe(408);
    expect(signal?.aborted).toBe(true);
    gate.resolve(generated({ tags: [{ name: "迟到建议", reason: "不能返回", confidence: 0.8 }] }));
    await flush();
    expect(await response.text()).not.toContain("迟到建议");
    expect(f.generate).toHaveBeenCalledTimes(2);
  });

  it("聊天模型持续无结束事件也在单次 60 秒停止", async () => {
    const f = fixture();
    const response = await f.request(true);
    const text = response.text();
    await flush();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(f.streamSignals[0]?.aborted).toBe(true);
    const body = await text;
    expect(body).toContain("上游请求超时");
    expect(body).not.toContain("event: done");
    expect(f.stream).toHaveBeenCalledOnce();
  });

  it("180 秒预算跨规划、多个工具和最终生成累计", async () => {
    const f = fixture();
    const sleep = () => new Promise<void>((done) => setTimeout(done, 55_000));
    const original = f.generate.getMockImplementation()!;
    f.generate.mockImplementation(async (options) => { await sleep(); return original(options); });
    f.read.mockImplementation(async () => { await sleep(); return tags(); });
    const pending = f.request();
    await flush();
    await vi.advanceTimersByTimeAsync(180_000);
    const response = await pending;
    expect(response.status).toBe(504);
    expect(await response.text()).toContain("任务运行超时");
    expect(f.clientSignal.aborted).toBe(true);
    expect(f.generate).toHaveBeenCalledTimes(2);
    expect(f.read).toHaveBeenCalledTimes(2);
    expect(JSON.parse(String(f.patches()[0][1]?.body))).toMatchObject({ status: "failed", error_summary: "任务运行超时" });
  });

  it("聊天已输出片段后取消，不发送 done 并停止流式模型", async () => {
    const f = fixture();
    const response = await f.request(true);
    const text = response.text();
    // 流式模型启动跨一次宏任务调度，单次 flush 在 CI 的 Node 时序下可能不足，须自旋等待流真正建立
    for (let i = 0; f.stream.mock.calls.length === 0 && i < 1000; i++) {
      await flush();
      await vi.advanceTimersByTimeAsync(1);
    }
    expect(f.stream).toHaveBeenCalledOnce();
    f.controller.abort();
    await flush();
    expect(f.streamSignals[0]?.aborted).toBe(true);
    const body = await text;
    expect(body).toContain("event: error");
    expect(body).toContain("任务已取消");
    expect(body).not.toContain("event: done");
    expect(JSON.parse(String(f.patches()[0][1]?.body)).status).toBe("failed");
  });

  it("SSE 读端取消也传播到请求级控制器", async () => {
    const f = fixture();
    const response = await f.request(true);
    const reader = response.body!.getReader();
    await reader.read();
    await flush();
    await reader.cancel();
    await flush();
    expect(f.controller.signal.aborted).toBe(false);
    expect(f.clientSignal.aborted).toBe(true);
    expect(f.patches()).toHaveLength(1);
    expect(JSON.parse(String(f.patches()[0][1]?.body)).status).toBe("failed");
  });

  it("成功终态后 SSE 投递阻塞最多等待 5 秒，不再次改写终态", async () => {
    const f = fixture();
    const write = SSEStreamingApi.prototype.writeSSE;
    vi.spyOn(SSEStreamingApi.prototype, "writeSSE").mockImplementation(async function (
      this: SSEStreamingApi, message,
    ) {
      if (message.event === "done") return new Promise(() => undefined);
      return write.call(this, message);
    });
    f.stream.mockImplementationOnce(async () => ({ stream: new ReadableStream({ start(output) {
      output.enqueue({ type: "stream-start", warnings: [] });
      output.enqueue({ type: "text-start", id: "t" });
      output.enqueue({ type: "text-delta", id: "t", delta: "完整结果" });
      output.enqueue({ type: "text-end", id: "t" });
      output.enqueue({ type: "finish", finishReason: { unified: "stop", raw: undefined }, usage });
      output.close();
    } }) }));
    const response = await f.request(true);
    const reader = response.body!.getReader();
    await reader.read();
    await reader.read();
    await flush();
    await vi.advanceTimersByTimeAsync(0);
    try {
      expect(f.patches()).toHaveLength(1);
      expect(JSON.parse(String(f.patches()[0][1]?.body)).status).toBe("succeeded");
      await vi.advanceTimersByTimeAsync(5_000);
      expect(JSON.stringify(f.errorLog.mock.calls)).toContain("agent_stream_delivery_failed");
      expect(vi.getTimerCount()).toBe(0);
      expect(f.patches()).toHaveLength(1);
    } finally { await reader.cancel(); }
  });

  it("取消后的失败审计最多再等 5 秒，失败可追踪且无原始异常", async () => {
    const f = fixture();
    f.generate.mockImplementationOnce(async () => new Promise(() => undefined));
    f.finish.mockImplementation(async () => new Promise(() => undefined));
    const pending = f.request();
    await flush();
    f.controller.abort(new Error("private-reason"));
    await flush();
    await vi.advanceTimersByTimeAsync(5_000);
    const response = await pending;
    expect(response.status).toBe(503);
    expect(await response.text()).toContain("trace-stop");
    const logs = JSON.stringify(f.errorLog.mock.calls);
    expect(logs).toContain("trace-stop");
    expect(logs).not.toContain("private-reason");
    expect(f.patches()).toHaveLength(1);
  });

  it.each([401, 403])("取消后的清理被拒 %s 时不回退服务身份或重试", async (status) => {
    const f = fixture();
    f.generate.mockImplementationOnce(async () => new Promise(() => undefined));
    f.finish.mockResolvedValue(Response.json({ code: status, data: null, message: "private-backend-error" }, { status }));
    const pending = f.request();
    await flush();
    f.controller.abort();
    await flush();
    const response = await pending;
    expect(response.status).toBe(status);
    expect(await response.text()).not.toContain("private-backend-error");
    expect(f.patches()).toHaveLength(1);
    expect(f.generate).toHaveBeenCalledOnce();
    expect(f.read).not.toHaveBeenCalled();
  });

  it("成功终态正在提交时取消，报告审计不确定且不盲目再次写终态", async () => {
    const f = fixture();
    f.finish.mockImplementation(async () => new Promise(() => undefined));
    const pending = f.request();
    await flush();
    await vi.advanceTimersByTimeAsync(0);
    expect(f.finish).toHaveBeenCalledOnce();
    f.controller.abort();
    await flush();
    const response = await pending;
    expect(response.status).toBe(503);
    expect(await response.text()).toContain("运行记录未完成");
    expect(f.patches()).toHaveLength(1);
    expect(JSON.stringify(f.errorLog.mock.calls)).toContain("trace-stop");
  });

  it("正常结束释放运行与单次调用定时器", async () => {
    const f = fixture();
    expect((await f.request()).status).toBe(200);
    expect(vi.getTimerCount()).toBe(0);
    expect(JSON.parse(String(f.patches()[0][1]?.body)).status).toBe("succeeded");
  });
});
