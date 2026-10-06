// task router 与 handler 测试：mock 模型 + mock 内部客户端，不依赖真实网络
import { describe, expect, it, vi } from "vitest";
import { MockLanguageModelV4 } from "ai/test";
import { z } from "zod";

import "../src/tasks";
import { dispatchTask, TaskRouterError } from "../src/tasks/router";
import { createRunContext } from "../src/observability/run-context";
import type { InternalClient } from "../src/internal-client";
import type { TaskContext } from "../src/tasks/router";
import type { TaskType } from "../src/types";

const zeroUsage = {
  inputTokens: { total: 0, noCache: 0, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 0, text: 0, reasoning: 0 },
};

/** doGenerate 返回指定文本序列：第 n 次调用返回第 n 个结果 */
const modelWithText = (...texts: string[]) =>
  new MockLanguageModelV4({
    doGenerate: texts.map((text) => ({
      content: [{ type: "text", text }],
      // V4 规范：finishReason 是 { unified, raw } 对象
      finishReason: { unified: "stop", raw: undefined },
      usage: zeroUsage,
      warnings: [],
    })),
  });

const buildContext = (model: TaskContext["model"], client?: InternalClient): TaskContext => ({
  runContext: createRunContext({ taskType: "suggest_tags", traceId: "trace-router-1" }),
  model,
  internalClient: client,
});

describe("task router dispatch", () => {
  it("routes to registered handler by task type", async () => {
    // handler 装配已在导入 ../src/tasks 时完成，doc_draft 走真实 handler
    const result = await dispatchTask(
      "doc_draft",
      { topic: "进程与线程" },
      buildContext(
        modelWithText(JSON.stringify({ title: "进程与线程", bodyMarkdown: "# 概述" })),
      ),
    );
    expect(result).toEqual({ title: "进程与线程", bodyMarkdown: "# 概述" });
  });

  it("rejects unknown task type", async () => {
    // TaskType 联合类型保证编译期合法，运行时仍以 router 拒绝兜底
    await expect(
      dispatchTask("no_such_task" as TaskType, {}, buildContext(modelWithText("{}"))),
    ).rejects.toBeInstanceOf(TaskRouterError);
  });

  it("rejects invalid input before reaching handler", async () => {
    await expect(
      dispatchTask("suggest_tags", { questionTitle: "" }, buildContext(modelWithText("{}"))),
    ).rejects.toBeInstanceOf(z.ZodError);
  });
});

describe("suggest_tags handler", () => {
  it("returns structured tags with confidence and text-only basis note", async () => {
    const model = modelWithText(
      JSON.stringify({
        tags: [{ name: "操作系统", reason: "涉及进程调度", confidence: 0.92 }],
      }),
    );
    const result = await dispatchTask(
      "suggest_tags",
      { questionTitle: "进程调度顺序如何确定", questionBody: "不确定先来先服务还是优先级调度" },
      buildContext(model),
    );
    expect(result).toMatchObject({ tags: [{ name: "操作系统", confidence: 0.92 }] });
    // E-09：词表缺位时依据说明必须明确为文本语义匹配、无站内历史数据依据
    expect(result).toMatchObject({ basisNote: expect.stringContaining("无站内历史数据依据") });
  });
});

describe("similar_questions handler", () => {
  it("retrieves candidates via internal client and composes title/url from in-site data", async () => {
    const client: InternalClient = {
      searchCourses: vi.fn().mockResolvedValue([]),
      searchQuestions: vi.fn().mockResolvedValue([{ id: 9, title: "银行家算法", courseId: 2 }]),
      fetchTags: vi.fn().mockResolvedValue([]),
    };
    // 模型只输出 questionId 与 reason；title/url 由 handler 依据站内候选组装
    const model = modelWithText(
      JSON.stringify({
        items: [{ questionId: 9, reason: "同为死锁避免问题" }],
      }),
    );
    const context = buildContext(model, client);
    const result = await dispatchTask(
      "similar_questions",
      { questionTitle: "死锁避免有哪些算法", questionBody: "希望结合例题说明", courseId: 2 },
      context,
    );

    expect(client.searchQuestions).toHaveBeenCalledWith(
      { keyword: "死锁避免有哪些算法", courseId: 2, limit: 5 },
      context.runContext.traceId,
    );
    expect(result).toMatchObject({
      hasInSiteEvidence: true,
      items: [{ questionId: 9, title: "银行家算法", url: "/questions/9", reason: "同为死锁避免问题" }],
    });
  });

  it("runs without internal client and reports no in-site evidence without calling the model", async () => {
    // 空字符串模型作为绊线：handler 若错误地调用模型，generateObject 解析失败将抛 SelfCheckError
    const model = modelWithText("{}");
    const result = await dispatchTask(
      "similar_questions",
      { questionTitle: "完全无关的新问题", questionBody: "没有任何候选" },
      buildContext(model),
    );
    expect(result).toEqual({
      items: [],
      hasInSiteEvidence: false,
      note: "未接入站内问题检索服务，本次推荐无站内依据。",
    });
  });
});

describe("moderation_scan handler", () => {
  it("only produces assessment, never executes any action", async () => {
    const clientSpy: InternalClient = {
      searchCourses: vi.fn(),
      searchQuestions: vi.fn(),
      fetchTags: vi.fn(),
    };
    const model = modelWithText(
      JSON.stringify({ riskLevel: "high", shouldEscalate: true, reason: "疑似辱骂内容" }),
    );
    const result = await dispatchTask(
      "moderation_scan",
      { targetType: "answer", targetId: 12, contentExcerpt: "……" },
      buildContext(model, clientSpy),
    );

    expect(result).toEqual({ riskLevel: "high", shouldEscalate: true, reason: "疑似辱骂内容" });
    // 低风险白名单客户端不应被 moderation_scan 调用；处置动作一律走 T-15 审批工单
    expect(clientSpy.searchCourses).not.toHaveBeenCalled();
    expect(clientSpy.searchQuestions).not.toHaveBeenCalled();
    expect(clientSpy.fetchTags).not.toHaveBeenCalled();
  });
});

describe("self-check with retry", () => {
  it("retries once when the first output fails schema validation", async () => {
    const model = modelWithText(
      "这不是 JSON",
      JSON.stringify({ tags: [{ name: "并发", reason: "主题匹配", confidence: 0.8 }] }),
    );
    const result = await dispatchTask(
      "suggest_tags",
      { questionTitle: "并发与并行区别", questionBody: "概念辨析" },
      buildContext(model),
    );
    expect(result).toMatchObject({ tags: [{ name: "并发" }] });
  });

  it("raises SelfCheckError when retries are exhausted, without returning unvalidated output", async () => {
    const model = modelWithText("坏输出 1", "坏输出 2");
    await expect(
      dispatchTask(
        "suggest_tags",
        { questionTitle: "概念题", questionBody: "正文" },
        buildContext(model),
      ),
    ).rejects.toThrow("self-check failed");
  });
});
