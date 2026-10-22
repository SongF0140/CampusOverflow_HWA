import { afterEach, describe, expect, it, vi } from "vitest";
import { MockLanguageModelV4 } from "ai/test";
import { SSEStreamingApi } from "hono/streaming";

import { createApp } from "../src/app";
import { InternalApiError } from "../src/internal-client";
import { auditStub } from "./helpers/audit-stub";

const usage = { inputTokens: { total: 0, noCache: 0, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 0, text: 0, reasoning: 0 } };
const generated = (data: unknown) => ({ content: [{ type: "text" as const,
  text: typeof data === "string" ? data : JSON.stringify(data) }],
  finishReason: { unified: "stop" as const, raw: undefined }, usage, warnings: [] });
const approved = { passed: true, issues: [] };
const rejected = { passed: false, issues: ["off_topic"] };
const draft = { title: "线程", bodyMarkdown: "参考[真实问题](/questions/9)。" };
const plan = (count = 1) => ({ steps: Array.from({ length: count }, (_, i) => ({
  stepId: `s${i + 1}`, objective: "检索参考", toolName: "searchQuestions",
  args: { keyword: "线程", courseId: 2, limit: 5 },
})) });
const flush = async () => { for (let i = 0; i < 300; i++) await Promise.resolve(); };

function fixture(outputs: unknown[], chatTexts = ["已核验的建议"]) {
  const controller = new AbortController();
  const queue = [...outputs];
  const generate = vi.fn(async (_options: Parameters<MockLanguageModelV4["doGenerate"]>[0]) => generated(queue.shift()));
  const stream = vi.fn(async () => ({ stream: new ReadableStream({ start(output) {
    output.enqueue({ type: "stream-start", warnings: [] });
    output.enqueue({ type: "text-start", id: "t" });
    output.enqueue({ type: "text-delta", id: "t", delta: chatTexts.shift() ?? "建议" });
    output.enqueue({ type: "text-end", id: "t" });
    output.enqueue({ type: "finish", finishReason: { unified: "stop", raw: undefined }, usage });
    output.close();
  } }) }));
  const audit = auditStub();
  const client = { audit,
    resolvePrincipal: vi.fn().mockResolvedValue({ user_id: 3, role: "student", status: "active",
      identity_type: "undergraduate", assistant_cert_status: "none" }),
    searchCourses: vi.fn().mockResolvedValue([]),
    searchQuestions: vi.fn().mockResolvedValue([{ id: 9, title: "真实问题", courseId: 2 }]),
    fetchTags: vi.fn().mockResolvedValue([{ id: 7, name: "并发", type: "tech" }]),
    fetchModerationTarget: vi.fn().mockResolvedValue({ targetType: "answer", targetId: 12, authorId: 3, body: "真实原文" }),
  };
  const model = new MockLanguageModelV4({ doGenerate: generate, doStream: stream });
  const app = createApp({ getModel: () => model, createClient: () => client });
  const request = (kind = "doc_draft", input: unknown = { topic: "线程", courseId: 2 }) => app.request(
    kind === "chat" ? "/agent/chat" : `/agent/tasks/${kind}`, { method: "POST",
      headers: { authorization: "Bearer secret", "x-trace-id": "trace-review" },
      body: JSON.stringify(input), signal: controller.signal });
  const reviews = () => generate.mock.calls.filter(([options]) => JSON.stringify(options.prompt).includes("受控结果审查器"));
  return { generate, stream, client, audit, model, request, reviews, controller };
}

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

describe("来源检查与有限返工", () => {
  it("正常结果必须通过模型审查后才能返回成功", async () => {
    const f = fixture([plan(), draft, approved]);
    expect((await f.request()).status).toBe(200);
    expect(f.reviews()).toHaveLength(1);
    expect(f.generate).toHaveBeenCalledTimes(3);
    expect(JSON.stringify(f.reviews()[0][0].prompt)).toContain("真实问题");
  });

  it("正常教学泛型代码不是 HTML 来源，不应误拦截", async () => {
    const f = fixture([plan(), { ...draft, bodyMarkdown: "示例：`Promise<T>` 和 `List<String>`，参考[问题](/questions/9)。" }, approved]);
    expect((await f.request()).status).toBe(200);
    expect(f.reviews()).toHaveLength(1);
  });

  it("未知来源先被程序拒绝，修复前不调用审查器", async () => {
    const f = fixture([plan(), { ...draft, bodyMarkdown: "[伪造来源](/questions/999)" }, plan(), draft, approved]);
    const response = await f.request();
    expect(response.status).toBe(200);
    expect(await response.text()).not.toContain("伪造来源");
    expect(f.reviews()).toHaveLength(1);
    expect(f.client.searchQuestions).toHaveBeenCalledTimes(2);
    expect(f.audit.recordEvent.mock.calls.filter((call) => call[1].event_type === "plan")).toHaveLength(2);
  });

  it("模型否定最多触发一版新计划，第二次否定即失败", async () => {
    const f = fixture([plan(), draft, rejected, plan(), draft, rejected]);
    const response = await f.request();
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("bodyMarkdown");
    expect(f.generate).toHaveBeenCalledTimes(6);
    expect(f.client.searchQuestions).toHaveBeenCalledTimes(2);
    expect(f.audit.finishRun.mock.calls[0][1].status).toBe("failed");
    expect(f.audit.finishRun.mock.calls[0][1].error_summary).toContain("自检");
    expect(JSON.stringify(f.model.doGenerateCalls[3].prompt)).toContain("off_topic");
  });

  it("返工反馈进入最终生成提示，修正结果再次通过自检", async () => {
    const f = fixture([plan(), draft, rejected, plan(), draft, approved]);
    expect((await f.request()).status).toBe(200);
    expect(JSON.stringify(f.model.doGenerateCalls[4].prompt)).toContain("off_topic");
    expect(f.reviews()).toHaveLength(2);
    expect(f.audit.finishRun.mock.calls[0][1].status).toBe("succeeded");
  });

  it.each([
    ["suggest_tags", "fetchTags", { limit: 5 }, { questionTitle: "线程", questionBody: "并发" },
      { tags: [{ name: "并发", reason: "主题相关", confidence: 0.8 }] }],
    ["similar_questions", "searchQuestions", { keyword: "线程", courseId: 2 }, { questionTitle: "线程", courseId: 2 },
      { items: [{ questionId: 9, reason: "相似" }] }],
    ["moderation_scan", "fetchModerationTarget", { targetType: "answer", targetId: 12 },
      { targetType: "answer", targetId: 12, contentExcerpt: "摘录" }, { riskLevel: "high", shouldEscalate: true, reason: "需要人工复核" }],
  ])("%s 生产入口必须进行结果自检", async (kind, toolName, args, input, output) => {
    const f = fixture([{ steps: [{ stepId: "s1", objective: "获取依据", toolName, args }] }, output, approved]);
    expect((await f.request(String(kind), input)).status).toBe(200);
    expect(f.reviews()).toHaveLength(1);
    expect(f.generate).toHaveBeenCalledTimes(3);
  });

  it.each([401, 403])("返工时撤权 %s 立即终止，不再生成或审查", async (status) => {
    const f = fixture([plan(), draft, rejected, plan(), draft, approved]);
    f.client.searchQuestions.mockResolvedValueOnce([{ id: 9, title: "真实问题", courseId: 2 }])
      .mockRejectedValueOnce(new InternalApiError(status, status, "private-backend-reason"));
    const response = await f.request();
    expect(response.status).toBe(status);
    expect(await response.text()).not.toContain("private-backend-reason");
    expect(f.generate).toHaveBeenCalledTimes(4);
    expect(f.reviews()).toHaveLength(1);
  });

  it("返工不能改写原课程范围", async () => {
    const badPlan = plan(); badPlan.steps[0].args.courseId = 99;
    const f = fixture([plan(), draft, rejected, badPlan, draft, approved]);
    expect((await f.request()).status).toBe(500);
    expect(f.client.searchQuestions).toHaveBeenCalledOnce();
    expect(f.generate).toHaveBeenCalledTimes(4);
  });

  it("180 秒运行上限跨返工累计，不因新计划重置", async () => {
    vi.useFakeTimers();
    const f = fixture([plan(), draft, rejected, plan(), draft, approved]);
    const sleep = () => new Promise<void>((resolve) => setTimeout(resolve, 30_000));
    const generate = f.generate.getMockImplementation()!;
    const query = f.client.searchQuestions.getMockImplementation()!;
    f.generate.mockImplementation(async (options) => { await sleep(); return generate(options); });
    f.client.searchQuestions.mockImplementation(async () => { await sleep(); return query(); });
    const pending = f.request();
    await flush();
    await vi.advanceTimersByTimeAsync(180_000);
    const response = await pending;
    expect(response.status).toBe(504);
    expect(await response.text()).toContain("任务运行超时");
    expect(f.generate).toHaveBeenCalledTimes(4);
    expect(f.audit.finishRun.mock.calls[0][1]).toMatchObject({ status: "failed", error_summary: "任务运行超时" });
  });

  it("结构修复与否定自检共用一次预算，不允许每阶段重置", async () => {
    const f = fixture(['{"steps":', plan(), draft, rejected, plan(), draft, approved]);
    expect((await f.request()).status).toBe(500);
    expect(f.generate).toHaveBeenCalledTimes(4);
    expect(f.client.searchQuestions).toHaveBeenCalledOnce();
  });

  it("计划修复用尽预算后，最终结果结构错误不能再修复", async () => {
    const f = fixture(['{"steps":', plan(), { wrong: "结果结构" }, draft, approved]);
    expect((await f.request()).status).toBe(500);
    expect(f.generate).toHaveBeenCalledTimes(3);
    expect(f.reviews()).toHaveLength(0);
  });

  it("返工累计最多 12 次调用，记录前守预算且不创建第 13 次开始事件", async () => {
    const f = fixture([plan(8), draft, rejected, plan(8), draft, approved]);
    expect((await f.request()).status).toBe(500);
    expect(f.client.searchQuestions).toHaveBeenCalledTimes(12);
    expect(f.audit.recordEvent.mock.calls.filter((call) => call[1].event_type === "step_started")).toHaveLength(12);
    expect(f.generate).toHaveBeenCalledTimes(4);
  });

  it.each(["/questions/999", "/questions/%39", "https://site.test/questions/9", "../questions/9",
    '<a href="/questions/9">链接</a>'])("来源变体 %s 不得由模型审查放行", async (url) => {
    const bad = { ...draft, bodyMarkdown: url.startsWith("<") ? url : `[链接](${url})` };
    const f = fixture([plan(), bad, plan(), bad, approved]);
    expect((await f.request()).status).toBe(500);
    expect(f.reviews()).toHaveLength(0);
  });

  it("新一轮证据清空，不能借用上轮结果伪装本轮检索成功", async () => {
    const f = fixture([plan(), draft, rejected, plan(), draft, approved]);
    f.client.searchQuestions.mockResolvedValueOnce([{ id: 9, title: "真实问题", courseId: 2 }]).mockResolvedValueOnce([]);
    expect((await f.request()).status).toBe(500);
    expect(f.reviews()).toHaveLength(1);
  });

  it("审查响应不能携带工具动作或任意反馈", async () => {
    const f = fixture([plan(), draft, { passed: true, issues: [], tool: "deleteQuestion", reason: "private-secret" }]);
    const response = await f.request();
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("private-secret");
    expect(f.client.searchQuestions).toHaveBeenCalledOnce();
  });

  it("审查等待中取消，不返工、不使用迟到认可", async () => {
    const f = fixture([plan(), draft]);
    const original = f.generate.getMockImplementation()!;
    let release!: (value: ReturnType<typeof generated>) => void;
    f.generate.mockImplementationOnce(original).mockImplementationOnce(original).mockImplementationOnce(
      async () => new Promise((resolve) => { release = resolve; }));
    const pending = f.request();
    await vi.waitFor(() => expect(f.generate).toHaveBeenCalledTimes(3));
    f.controller.abort();
    expect((await pending).status).toBe(408);
    release(generated(approved));
    await flush();
    expect(f.generate).toHaveBeenCalledTimes(3);
    expect(f.audit.finishRun.mock.calls[0][1].status).toBe("failed");
  });

  it("聊天不发送未通过的文本，修复后沿用原 SSE 事件", async () => {
    const f = fixture([{ steps: [] }, { steps: [] }, approved], ["[私有伪造](/questions/999)", "校验后的回答"]);
    const body = await (await f.request("chat", { message: "学习建议" })).text();
    expect(body).not.toContain("私有伪造");
    expect(body).toContain("校验后的回答");
    expect(body).toContain("event: done");
    expect(f.stream).toHaveBeenCalledTimes(2);
    expect(f.reviews()).toHaveLength(1);
  });

  it("聊天模型完成但审查未返回时不能发送 delta", async () => {
    const f = fixture([{ steps: [] }]);
    const original = f.generate.getMockImplementation()!;
    let release!: (value: ReturnType<typeof generated>) => void;
    f.generate.mockImplementationOnce(original).mockImplementationOnce(async () => new Promise((resolve) => { release = resolve; }));
    const write = vi.spyOn(SSEStreamingApi.prototype, "writeSSE");
    const response = await f.request("chat", { message: "学习建议" });
    const text = response.text();
    try {
      await vi.waitFor(() => expect(f.generate).toHaveBeenCalledTimes(2));
      expect(write.mock.calls.some(([event]) => event.event === "delta")).toBe(false);
    } finally { release?.(generated(approved)); }
    expect(await text).toContain("event: done");
  });
});
