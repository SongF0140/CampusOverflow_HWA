// T-13 推荐任务测试（US-11/US-12/E-09）：mock 模型 + mock 内部客户端，零真实网络
// 覆盖：happy path、自检重试与失败路径、无站内依据说明文案、只读断言（无任何写通道）
import { describe, expect, it, vi } from "vitest";
import { MockLanguageModelV4 } from "ai/test";

import type { InternalClient } from "../src/internal-client";
import { createRunContext } from "../src/observability/run-context";
// 装配副作用导入：四个内置 handler 在模块导入时注册进 task router
import "../src/tasks";
import { dispatchTask } from "../src/tasks/router";
import type { TaskContext } from "../src/tasks/router";

const zeroUsage = {
  inputTokens: { total: 0, noCache: 0, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 0, text: 0, reasoning: 0 },
};

/** doGenerate 返回指定文本序列：第 n 次调用返回第 n 个结果 */
const modelWithText = (...texts: string[]) =>
  new MockLanguageModelV4({
    doGenerate: texts.map((text) => ({
      content: [{ type: "text", text }],
      finishReason: { unified: "stop", raw: undefined },
      usage: zeroUsage,
      warnings: [],
    })),
  });

const buildContext = (model: TaskContext["model"], client?: InternalClient): TaskContext => ({
  runContext: createRunContext({ taskType: "suggest_tags", traceId: "trace-recommend-1" }),
  model,
  internalClient: client,
});

/** mock 内部客户端：两个 GET 检索方法 + 标签词表 + post/patch/put 探针（接口本身不含写方法，
 * 探针用于断言 handler 全程无任何写通道被触发） */
const buildClientMock = (
  questions: Array<{ id: number; title: string; courseId: number }>,
  tags: Array<{ id: number; name: string; type: string }> = [],
) => {
  const writeProbes = { post: vi.fn(), patch: vi.fn(), put: vi.fn() };
  const client = {
    searchCourses: vi.fn().mockResolvedValue([]),
    searchQuestions: vi.fn().mockResolvedValue(questions),
    fetchTags: vi.fn().mockResolvedValue(tags),
    ...writeProbes,
  } as unknown as InternalClient;
  return { client, writeProbes };
};

describe("suggest_tags（US-11/E-09）", () => {
  it("有词表：命中词表的标签附站内 id，依据说明明确词表依据", async () => {
    const { client, writeProbes } = buildClientMock(
      [],
      [
        { id: 7, name: "操作系统", type: "tech" },
        { id: 8, name: "并发", type: "tech" },
      ],
    );
    const model = modelWithText(
      JSON.stringify({
        tags: [
          { name: "操作系统", reason: "正文讨论进程调度", confidence: 0.9 },
          { name: "并发", reason: "涉及并发概念", confidence: 0.7 },
          { name: "新概念", reason: "词表中没有合适项", confidence: 0.5 },
        ],
      }),
    );
    const context = buildContext(model, client);
    const result = (await dispatchTask(
      "suggest_tags",
      { questionTitle: "进程和线程的区别是什么", questionBody: "操作系统中进程与线程概念辨析" },
      context,
    )) as { tags: Array<{ name: string; tagId?: number }>; basisNote: string };

    expect(client.fetchTags).toHaveBeenCalledWith(
      { limit: 100 },
      context.runContext.traceId,
    );
    // 命中词表的标签附站内 id（供用户确认后绑定）；未命中项不附 id
    expect(result.tags).toEqual([
      { name: "操作系统", reason: "正文讨论进程调度", confidence: 0.9, tagId: 7 },
      { name: "并发", reason: "涉及并发概念", confidence: 0.7, tagId: 8 },
      { name: "新概念", reason: "词表中没有合适项", confidence: 0.5 },
    ]);
    expect(result.basisNote).toContain("站内标签词表");
    // 只读：suggest_tags 不触碰检索与写通道
    expect(client.searchQuestions).not.toHaveBeenCalled();
    expect(client.searchCourses).not.toHaveBeenCalled();
    expect(writeProbes.post).not.toHaveBeenCalled();
    expect(writeProbes.patch).not.toHaveBeenCalled();
    expect(writeProbes.put).not.toHaveBeenCalled();
  });

  it("空词表降级：依据说明为文本语义匹配，不附站内 id", async () => {
    const { client, writeProbes } = buildClientMock([]);
    const model = modelWithText(
      JSON.stringify({
        tags: [
          { name: "操作系统", reason: "正文讨论进程调度", confidence: 0.9 },
          { name: "并发", reason: "涉及并发概念", confidence: 0.7 },
        ],
      }),
    );
    const result = (await dispatchTask(
      "suggest_tags",
      { questionTitle: "进程和线程的区别是什么", questionBody: "操作系统中进程与线程概念辨析" },
      buildContext(model, client),
    )) as { tags: Array<{ name: string; tagId?: number }>; basisNote: string };

    expect(client.fetchTags).toHaveBeenCalledTimes(1);
    expect(result.tags).toEqual([
      { name: "操作系统", reason: "正文讨论进程调度", confidence: 0.9 },
      { name: "并发", reason: "涉及并发概念", confidence: 0.7 },
    ]);
    expect(result.basisNote).toContain("依据为文本语义匹配");
    expect(result.basisNote).toContain("无站内历史数据依据");
    // 只读：suggest_tags 全程不触碰内部接口写通道
    expect(client.searchQuestions).not.toHaveBeenCalled();
    expect(client.searchCourses).not.toHaveBeenCalled();
    expect(writeProbes.post).not.toHaveBeenCalled();
    expect(writeProbes.patch).not.toHaveBeenCalled();
    expect(writeProbes.put).not.toHaveBeenCalled();
  });

  it("词表拉取失败降级：按空词表运行，依据说明为文本语义匹配", async () => {
    const { client } = buildClientMock([]);
    (client as unknown as { fetchTags: ReturnType<typeof vi.fn> }).fetchTags =
      vi.fn().mockRejectedValue(new Error("backend down"));
    const model = modelWithText(
      JSON.stringify({
        tags: [{ name: "并发", reason: "涉及并发概念", confidence: 0.7 }],
      }),
    );
    const result = (await dispatchTask(
      "suggest_tags",
      { questionTitle: "题目", questionBody: "正文" },
      buildContext(model, client),
    )) as { tags: Array<{ name: string; tagId?: number }>; basisNote: string };

    expect(result.tags).toEqual([{ name: "并发", reason: "涉及并发概念", confidence: 0.7 }]);
    expect(result.basisNote).toContain("依据为文本语义匹配");
    expect(result.basisNote).toContain("无站内历史数据依据");
  });

  it("标签数量截断至请求的 tagCount 上限", async () => {
    const model = modelWithText(
      JSON.stringify({
        tags: [1, 2, 3, 4, 5].map((n) => ({ name: `标签${n}`, reason: "测试", confidence: 0.5 })),
      }),
    );
    const result = (await dispatchTask(
      "suggest_tags",
      { questionTitle: "题目", questionBody: "正文", tagCount: 3 },
      buildContext(model),
    )) as { tags: unknown[] };
    expect(result.tags).toHaveLength(3);
  });

  it("自检失败路径：模型连续输出不合法结构时抛 SelfCheckError，不返回未校验内容", async () => {
    const model = modelWithText("not json at all", "{broken");
    await expect(
      dispatchTask("suggest_tags", { questionTitle: "题目", questionBody: "正文" }, buildContext(model)),
    ).rejects.toThrow("self-check failed");
  });
});

describe("similar_questions（US-12）", () => {
  it("happy path：候选命中时模型挑选排序，id/标题/链接取自站内数据", async () => {
    const { client, writeProbes } = buildClientMock([
      { id: 9, title: "银行家算法例题", courseId: 2 },
      { id: 12, title: "死锁的四个必要条件", courseId: 2 },
    ]);
    const model = modelWithText(
      JSON.stringify({
        items: [
          { questionId: 9, reason: "同为死锁避免算法问题" },
          { questionId: 12, reason: "涉及死锁基础概念" },
        ],
      }),
    );
    const context = buildContext(model, client);
    const result = (await dispatchTask(
      "similar_questions",
      { questionTitle: "如何用银行家算法避免死锁", questionBody: "希望结合例题", courseId: 2 },
      context,
    )) as { items: Array<{ questionId: number; title: string; url: string; reason: string }>; hasInSiteEvidence: boolean; note: string };

    expect(client.searchQuestions).toHaveBeenCalledWith(
      { keyword: "如何用银行家算法避免死锁", courseId: 2, limit: 5 },
      context.runContext.traceId,
    );
    expect(result.hasInSiteEvidence).toBe(true);
    expect(result.items).toEqual([
      { questionId: 9, title: "银行家算法例题", url: "/questions/9", reason: "同为死锁避免算法问题" },
      { questionId: 12, title: "死锁的四个必要条件", url: "/questions/12", reason: "涉及死锁基础概念" },
    ]);
    // 只读：仅 GET 类检索方法，写探针零调用
    expect(writeProbes.post).not.toHaveBeenCalled();
    expect(writeProbes.patch).not.toHaveBeenCalled();
    expect(writeProbes.put).not.toHaveBeenCalled();
  });

  it("模型编造站内不存在的 questionId 被过滤，链接路径固定为 /questions/{id}", async () => {
    const { client } = buildClientMock([{ id: 9, title: "银行家算法例题", courseId: 2 }]);
    const model = modelWithText(
      JSON.stringify({
        items: [
          { questionId: 999, reason: "编造的问题" },
          { questionId: 9, reason: "真实命中" },
        ],
      }),
    );
    const result = (await dispatchTask(
      "similar_questions",
      { questionTitle: "如何用银行家算法避免死锁", questionBody: "希望结合例题" },
      buildContext(model, client),
    )) as { items: Array<{ questionId: number; url: string }>; hasInSiteEvidence: boolean };

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({ questionId: 9, url: "/questions/9" });
    expect(result.hasInSiteEvidence).toBe(true);
  });

  it("站内无命中时输出明确说明且不空转模型", async () => {
    const { client } = buildClientMock([]);
    // 绊线模型：handler 若错误地调用模型，"不应被调用"无法通过 JSON 解析，测试将失败
    const model = modelWithText("不应被调用");
    const result = (await dispatchTask(
      "similar_questions",
      { questionTitle: "全新问题", questionBody: "站内没有相似问题" },
      buildContext(model, client),
    )) as { items: unknown[]; hasInSiteEvidence: boolean; note: string };

    expect(client.searchQuestions).toHaveBeenCalledTimes(1);
    expect(result.items).toEqual([]);
    expect(result.hasInSiteEvidence).toBe(false);
    expect(result.note).toContain("无站内依据");
  });

  it("自检重试：模型首次输出不合法、重试输出合法结构时成功返回", async () => {
    const { client } = buildClientMock([{ id: 9, title: "银行家算法例题", courseId: 2 }]);
    const model = modelWithText(
      "这不是 JSON",
      JSON.stringify({ items: [{ questionId: 9, reason: "同为死锁避免问题" }] }),
    );
    const result = (await dispatchTask(
      "similar_questions",
      { questionTitle: "如何用银行家算法避免死锁", questionBody: "希望结合例题" },
      buildContext(model, client),
    )) as { items: unknown[]; hasInSiteEvidence: boolean };

    expect(result.hasInSiteEvidence).toBe(true);
    expect(result.items).toHaveLength(1);
  });

  it("自检失败路径：重试耗尽后抛 SelfCheckError", async () => {
    const { client } = buildClientMock([{ id: 9, title: "银行家算法例题", courseId: 2 }]);
    const model = modelWithText("坏输出 1", "坏输出 2");
    await expect(
      dispatchTask(
        "similar_questions",
        { questionTitle: "如何用银行家算法避免死锁", questionBody: "希望结合例题" },
        buildContext(model, client),
      ),
    ).rejects.toThrow("self-check failed");
  });
});
