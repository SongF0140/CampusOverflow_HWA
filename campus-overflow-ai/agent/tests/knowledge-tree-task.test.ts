// knowledge_tree 任务测试（K-03，KN-R01）：大纲分析建议、现有树去重过滤、
// 必需工具约束与降级边界（E-17：纯建议不写入，计划只含只读工具）。
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
const plan = { steps: [{ stepId: "s1", objective: "读取现有知识树", toolName: "fetchKnowledgeTree", args: { courseId: "$input.courseId" } }] };
const suggestions = { nodes: [
  { name: "进程", reason: "大纲第一章核心概念" },
  { name: "死锁", reason: "大纲第三章同步章节" },
  { name: "线程 ", reason: "大纲第二章并发章节" },
] };

function fixture(first: unknown, output: unknown = suggestions) {
  const outputs = [first, output];
  const generate = vi.fn(async (options: Parameters<MockLanguageModelV4["doGenerate"]>[0]) =>
    approvedReview(options) ?? ({
      content: [{ type: "text" as const, text: JSON.stringify(outputs.shift()) }],
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
    resolvePrincipal: vi.fn().mockResolvedValue(Object.freeze({ user_id: 3, role: "teacher", status: "active",
      identity_type: "postgraduate", assistant_cert_status: "none" })),
    searchCourses: vi.fn().mockResolvedValue([]),
    searchQuestions: vi.fn().mockResolvedValue([]),
    fetchTags: vi.fn().mockResolvedValue([]),
    fetchModerationTarget: vi.fn().mockResolvedValue({ targetType: "answer", targetId: 12,
      authorId: 1, courseId: 2, body: "后端原文" }),
    fetchKnowledgeTree: vi.fn().mockResolvedValue([{ id: 1, name: "进程" }]),
  };
  const app = createApp({ getModel: () => model, createClient: () => client });
  const request = (body: unknown) => app.request("/agent/tasks/knowledge_tree", {
    method: "POST", headers: { authorization: "Bearer user" }, body: JSON.stringify(body),
  });
  return { request, model, generate, stream, client };
}

describe("knowledge_tree 大纲分析任务", () => {
  it("读取现有树后产出建议：重复建议被程序剔除并在 notes 说明", async () => {
    const f = fixture(plan);
    const response = await f.request({ courseId: 2, outlineText: "第一章 进程与线程；第三章 死锁" });
    expect(response.status).toBe(200);
    const payload = (await response.json()) as { data: { nodes: Array<{ name: string }>; notes: string } };
    expect(payload.data.nodes.map((node) => node.name)).toEqual(["死锁", "线程"]);
    expect(payload.data.notes).toContain("剔除 1 个");
    // 计划与建议提示均含现有树节点名（模型侧也约束，程序侧兜底）
    expect(f.client.fetchKnowledgeTree).toHaveBeenCalledWith({ courseId: 2 }, expect.any(String));
    const suggestionPrompt = JSON.stringify(f.model.doGenerateCalls[1]?.prompt);
    expect(suggestionPrompt).toContain("现有知识树已有以下知识点");
    expect(suggestionPrompt).toContain("进程与线程");
  });

  it("彼此重复的建议同样剔除，全部去重时 notes 无剔除说明", async () => {
    const f = fixture(plan, { nodes: [{ name: "死锁", reason: "a" }, { name: " 死锁", reason: "b" }] });
    const response = await f.request({ courseId: 2, outlineText: "第三章 死锁" });
    expect(response.status).toBe(200);
    const payload = (await response.json()) as { data: { nodes: Array<{ name: string }>; notes: string } };
    expect(payload.data.nodes.map((node) => node.name)).toEqual(["死锁"]);
    expect(payload.data.notes).toContain("剔除 1 个");
  });

  it("计划必须包含 fetchKnowledgeTree：缺失即失败且不读取站内数据", async () => {
    const f = fixture({ steps: [] });
    const response = await f.request({ courseId: 2, outlineText: "大纲" });
    expect(response.status).toBe(500);
    expect(f.client.fetchKnowledgeTree).not.toHaveBeenCalled();
    expect(f.generate).toHaveBeenCalledTimes(1);
  });

  it("现有树读取普通故障不阻塞建议，notes 明确未过滤", async () => {
    const f = fixture(plan);
    f.client.fetchKnowledgeTree.mockRejectedValueOnce(new InternalApiError(500, 500, "private-backend-reason"));
    const response = await f.request({ courseId: 2, outlineText: "第一章 进程" });
    expect(response.status).toBe(200);
    const payload = (await response.json()) as { data: { notes: string } };
    expect(payload.data.notes).toContain("未经重复过滤");
    expect(JSON.stringify(payload)).not.toContain("private-backend-reason");
  });

  it.each([401, 403])("读取现有树时撤权 %s 不降级，直接失败", async (status) => {
    const f = fixture(plan);
    f.client.fetchKnowledgeTree.mockRejectedValueOnce(new InternalApiError(status, status, "denied"));
    const response = await f.request({ courseId: 2, outlineText: "大纲" });
    expect(response.status).toBe(status);
    expect(f.generate).toHaveBeenCalledTimes(1);
  });

  it("大纲文本与课程 ID 非法时 400", async () => {
    const f = fixture(plan);
    const response = await f.request({ courseId: 0, outlineText: "大纲" });
    expect(response.status).toBe(400);
    const response2 = await f.request({ courseId: 2, outlineText: "" });
    expect(response2.status).toBe(400);
    expect(f.generate).not.toHaveBeenCalled();
  });
});
