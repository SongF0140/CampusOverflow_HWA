import { describe, expect, it, vi } from "vitest";
import { MockLanguageModelV4, simulateReadableStream } from "ai/test";

import { createApp } from "../src/app";
import { InternalApiError, type UserInternalClient } from "../src/internal-client";
import { auditStub } from "./helpers/audit-stub";
import { approvedReview } from "./helpers/review-response";

const usage = {
  inputTokens: { total: 0, noCache: 0, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 0, text: 0, reasoning: 0 },
};
const plan = (toolName: string, args: Record<string, unknown>) => ({
  steps: [{ stepId: "s7", objective: "读取本次任务所需证据", toolName, args }],
});
const tagOutput = { tags: [{ name: "并发", reason: "讨论线程", confidence: 0.8 }] };
const draftOutput = { title: "线程", bodyMarkdown: "草稿" };
const riskOutput = { riskLevel: "low", shouldEscalate: false, reason: "正常" };

function fixture(first: unknown, output: unknown = tagOutput) {
  const outputs = [first, output];
  const generate = vi.fn(async (options: Parameters<MockLanguageModelV4["doGenerate"]>[0]) => approvedReview(options) ?? ({
    content: [{ type: "text" as const, text: JSON.stringify(outputs.shift() ?? output) }],
    finishReason: { unified: "stop" as const, raw: undefined }, usage, warnings: [],
  }));
  const stream = vi.fn(async () => ({ stream: simulateReadableStream({ chunks: [
    { type: "stream-start", warnings: [] }, { type: "text-start", id: "t1" },
    { type: "text-delta", id: "t1", delta: "建议回答" }, { type: "text-end", id: "t1" },
    { type: "finish", finishReason: { unified: "stop", raw: undefined }, usage },
  ] }) }));
  const model = new MockLanguageModelV4({ doGenerate: generate, doStream: stream });
  const client: UserInternalClient = {
    audit: auditStub(),
    resolvePrincipal: vi.fn().mockResolvedValue(Object.freeze({ user_id: 3, role: "student", status: "active",
      identity_type: "undergraduate", assistant_cert_status: "none" })),
    searchCourses: vi.fn().mockResolvedValue([]),
    searchQuestions: vi.fn().mockResolvedValue([{ id: 9, title: "真实参考", courseId: 2 }]),
    fetchTags: vi.fn().mockResolvedValue([{ id: 5, name: "并发", type: "tech" }]),
    fetchModerationTarget: vi.fn().mockResolvedValue({ targetType: "answer", targetId: 12,
      authorId: 1, courseId: 2, body: "后端原文" }),
  };
  const app = createApp({ getModel: () => model, createClient: () => client });
  const request = (path: string, body: unknown) => app.request(path, {
    method: "POST", headers: { authorization: "Bearer user" }, body: JSON.stringify(body),
  });
  return { request, model, generate, stream, client };
}

describe("统一模型规划入口", () => {
  it("标签采用模型给出的工具参数，真实标签 id 仍由程序映射", async () => {
    const f = fixture(plan("fetchTags", { limit: 7 }));
    const response = await f.request("/agent/tasks/suggest_tags", { questionTitle: "线程", questionBody: "并发" });
    expect(response.status).toBe(200);
    expect(f.client.fetchTags).toHaveBeenCalledWith({ limit: 7 }, expect.any(String));
    expect(await response.json()).toMatchObject({ data: { tags: [{ tagId: 5 }] } });
    expect(f.generate).toHaveBeenCalledTimes(3);
    const prompt = JSON.stringify(f.model.doGenerateCalls[0].prompt);
    expect(prompt).toContain("受控规划层");
    expect(prompt).not.toContain("fetchModerationTarget");
  });

  it("草稿使用模型计划的关键词和非固定步骤 id 收集证据", async () => {
    const f = fixture(plan("searchQuestions", { keyword: "线程调度", courseId: "$input.courseId", limit: 3 }), draftOutput);
    const response = await f.request("/agent/tasks/doc_draft", { topic: "线程", courseId: 2 });
    expect(response.status).toBe(200);
    expect(f.client.searchQuestions).toHaveBeenCalledWith({ keyword: "线程调度", courseId: 2, limit: 3 }, expect.any(String));
    expect(JSON.stringify(f.model.doGenerateCalls.at(-1)?.prompt)).toContain("真实参考");
  });

  it("风险扫描由模型规划，非固定步骤 id 的原文进入最终评估", async () => {
    const f = fixture(plan("fetchModerationTarget", { targetType: "$input.targetType", targetId: "$input.targetId" }), riskOutput);
    const response = await f.request("/agent/tasks/moderation_scan", { targetType: "answer", targetId: 12, contentExcerpt: "摘录" });
    expect(response.status).toBe(200);
    expect(JSON.stringify(f.model.doGenerateCalls[0].prompt)).toContain("受控规划层");
    expect(JSON.stringify(f.model.doGenerateCalls.at(-1)?.prompt)).toContain("后端原文");
    expect((await response.text())).not.toContain("未核验站内原文");
  });

  it.each([
    ["doc_draft", 99], ["doc_draft", undefined], ["similar_questions", 99], ["similar_questions", undefined],
  ])("%s 不能通过计划移除或改变课程约束（%s）", async (type, courseId) => {
    const f = fixture(plan("searchQuestions", { keyword: "线程", courseId }), draftOutput);
    const input = type === "doc_draft" ? { topic: "线程", courseId: 2 }
      : { questionTitle: "线程", questionBody: "并发", courseId: 2 };
    const response = await f.request(`/agent/tasks/${type}`, input);
    expect(response.status).toBe(500);
    expect(f.client.searchQuestions).not.toHaveBeenCalled();
    expect(f.generate).toHaveBeenCalledTimes(1);
  });

  it("风险扫描计划不能换目标，也不能降级掩盖错误计划", async () => {
    const f = fixture(plan("fetchModerationTarget", { targetType: "question", targetId: 99 }), riskOutput);
    const response = await f.request("/agent/tasks/moderation_scan", { targetType: "answer", targetId: 12, contentExcerpt: "摘录" });
    expect(response.status).toBe(500);
    expect(f.client.fetchModerationTarget).not.toHaveBeenCalled();
    expect(f.generate).toHaveBeenCalledTimes(1);
  });

  it.each([plan("searchQuestions", { keyword: "线程" }), { steps: [] }])("标签计划必须含词表工具且不能越出任务工具集", async (first) => {
    const f = fixture(first);
    const response = await f.request("/agent/tasks/suggest_tags", { questionTitle: "线程", questionBody: "并发" });
    expect(response.status).toBe(500);
    expect(f.client.fetchTags).not.toHaveBeenCalled();
    expect(f.client.searchQuestions).not.toHaveBeenCalled();
  });

  it("聊天执行模型计划并将结果交给无工具的流式回答", async () => {
    const f = fixture(plan("searchQuestions", { keyword: "线程" }));
    const response = await f.request("/agent/chat", { message: "站内有哪些线程问题" });
    const text = await response.text();
    expect(text).toContain("event: done");
    expect(f.generate).toHaveBeenCalledTimes(2);
    expect(f.client.searchQuestions).toHaveBeenCalledTimes(1);
    expect(f.model.doStreamCalls[0].tools ?? []).toHaveLength(0);
    expect(JSON.stringify(f.model.doStreamCalls[0].prompt)).toContain("真实参考");
  });

  it("聊天顺序执行多个模型步骤，前序结果引用仍受参数校验", async () => {
    const first = { steps: [
      { stepId: "s1", objective: "查课程", toolName: "searchCourses", args: { keyword: "操作系统" } },
      { stepId: "s2", objective: "查课程问题", toolName: "searchQuestions", args: {
        keyword: "线程", courseId: "$s1[0].id",
      } },
    ] };
    const f = fixture(first);
    vi.mocked(f.client.searchCourses).mockResolvedValue([{ id: 2, name: "操作系统" }]);
    const response = await f.request("/agent/chat", { message: "查操作系统中的线程问题" });
    expect(await response.text()).toContain("event: done");
    expect(f.client.searchQuestions).toHaveBeenCalledWith(expect.objectContaining({ keyword: "线程", courseId: 2 }), expect.any(String));
    expect(f.client.searchCourses).toHaveBeenCalledTimes(1);
    expect(f.stream).toHaveBeenCalledTimes(1);
  });

  it("纯知识聊天允许零步计划，保留 SSE 协议", async () => {
    const f = fixture({ steps: [] });
    const response = await f.request("/agent/chat", { message: "解释线程" });
    const text = await response.text();
    expect(text).toContain("event: meta");
    expect(text).toContain("event: delta");
    expect(text).toContain("event: done");
    expect(f.generate).toHaveBeenCalledTimes(2);
    expect(f.client.searchQuestions).not.toHaveBeenCalled();
  });

  it.each([401, 403])("聊天工具遇到 %s 后不再总结或调用后续工具", async (status) => {
    const first = plan("searchQuestions", { keyword: "线程" });
    first.steps.push({ ...first.steps[0], stepId: "s8" });
    const f = fixture(first);
    vi.mocked(f.client.searchQuestions).mockRejectedValue(new InternalApiError(status, status, "撤权"));
    const response = await f.request("/agent/chat", { message: "检索线程" });
    const text = await response.text();
    expect(text).toContain("event: error");
    expect(text).not.toContain("event: done");
    expect(f.client.searchQuestions).toHaveBeenCalledTimes(1);
    expect(f.stream).not.toHaveBeenCalled();
  });
});
