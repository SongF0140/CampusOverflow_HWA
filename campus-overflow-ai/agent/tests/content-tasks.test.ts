import { describe, expect, it, vi } from "vitest";
import { MockLanguageModelV4 } from "ai/test";

import "../src/tasks/index";
import { createInternalClient, InternalApiError, type InternalClient } from "../src/internal-client";
import { createRunContext } from "../src/observability/run-context";
import { dispatchTask, type TaskContext } from "../src/tasks/router";
import { ensureBuiltinTools } from "../src/tools/index";
import { createToolRegistry } from "../src/tools/registry";
import { asTraceId } from "../src/types";

const content = { targetType: "answer" as const, targetId: 12, authorId: 3, courseId: 2, title: "站内标题", body: "后端可见原文" };
const assessment = { riskLevel: "low", shouldEscalate: false, reason: "未见明显违规" };
const draft = { title: "进程调度", bodyMarkdown: "# 进程调度\n课程草稿" };
const usage = {
  inputTokens: { total: 0, noCache: 0, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 0, text: 0, reasoning: 0 },
};

function fixture(output: unknown, overrides: Partial<InternalClient> = {}, courseId?: number) {
  const prompts: string[] = [];
  const plan = { steps: [{ stepId: "s1", objective: "读取参考", toolName: output === assessment
    ? "fetchModerationTarget" : "searchQuestions", args: output === assessment
    ? { targetType: "$input.targetType", targetId: "$input.targetId" }
    : { keyword: "$input.topic", limit: 5, ...(courseId === undefined ? {} : { courseId: "$input.courseId" }) } }] };
  const outputs = [plan, output];
  const generate = vi.fn(async (options) => {
    prompts.push(JSON.stringify(options.prompt));
    return {
      content: [{ type: "text" as const, text: JSON.stringify(outputs.shift() ?? output) }],
      finishReason: { unified: "stop" as const, raw: undefined }, usage, warnings: [],
    };
  });
  const client: InternalClient = {
    searchCourses: vi.fn().mockResolvedValue([]),
    searchQuestions: vi.fn().mockResolvedValue([{ id: 9, title: "真实参考题", courseId: 2 }]),
    fetchTags: vi.fn().mockResolvedValue([]),
    fetchModerationTarget: vi.fn().mockResolvedValue(content), ...overrides,
  };
  const toolRegistry = createToolRegistry();
  ensureBuiltinTools(client, toolRegistry);
  const context: TaskContext = {
    model: new MockLanguageModelV4({ doGenerate: generate }), internalClient: client, toolRegistry,
    runContext: createRunContext({ taskType: "doc_draft", traceId: "trace-content-task" }),
  };
  return { context, client, prompts, generate };
}

describe("G-03-C 只读上下文", () => {
  it("风险扫描优先使用真实原文，不以请求方摘录替代站内正文", async () => {
    const f = fixture(assessment);
    const result = await dispatchTask("moderation_scan", {
      targetType: "answer", targetId: 12, contentExcerpt: "未经核实的摘录",
    }, f.context);
    expect(f.client.fetchModerationTarget).toHaveBeenCalledWith(
      { targetType: "answer", targetId: 12 }, f.context.runContext.traceId,
    );
    expect(f.prompts.at(-1)).toContain("后端可见原文");
    expect(f.prompts.at(-1)).not.toContain("未经核实的摘录");
    expect(result).toMatchObject({ riskLevel: "low", shouldEscalate: false });
    expect(f.client.searchQuestions).not.toHaveBeenCalled();
    expect(f.client.fetchTags).not.toHaveBeenCalled();
  });

  it.each([404, 503])("读取失败 %s 时明确以请求方摘录为依据", async (status) => {
    const f = fixture(assessment, {
      fetchModerationTarget: vi.fn().mockRejectedValue(new InternalApiError(status, status, "不可用")),
    });
    const result = await dispatchTask("moderation_scan", {
      targetType: "answer", targetId: 12, contentExcerpt: "请求方摘录",
    }, f.context) as { reason: string };
    expect(f.prompts.at(-1)).toContain("依据请求方提供的摘录");
    expect(result.reason).toContain("未核验站内原文");
  });

  it.each([401, 403])("读取时身份失效 %s 不再生成评估结果", async (status) => {
    const error = new InternalApiError(status, status, "拒绝");
    const f = fixture(assessment, { fetchModerationTarget: vi.fn().mockRejectedValue(error) });
    await expect(dispatchTask("moderation_scan", {
      targetType: "answer", targetId: 12, contentExcerpt: "摘录",
    }, f.context)).rejects.toBe(error);
    expect(f.generate).toHaveBeenCalledTimes(1);
  });

  it("文档草稿将真实历史问题参考交给模型并保留课程过滤", async () => {
    const f = fixture(draft, {}, 2);
    const result = await dispatchTask("doc_draft", { topic: "进程调度", courseId: 2 }, f.context);
    expect(f.client.searchQuestions).toHaveBeenCalledWith(
      { keyword: "进程调度", courseId: 2, limit: 5 }, f.context.runContext.traceId,
    );
    expect(f.prompts.at(-1)).toContain("真实参考题");
    expect(f.prompts.at(-1)).toContain("#9");
    expect(result).toEqual(draft);
    expect(f.client.fetchModerationTarget).not.toHaveBeenCalled();
  });

  it("普通参考检索故障按无资料起草", async () => {
    const f = fixture(draft, { searchQuestions: vi.fn().mockRejectedValue(new Error("offline")) });
    await dispatchTask("doc_draft", { topic: "进程调度" }, f.context);
    expect(f.prompts.at(-1)).toContain("站内参考：无");
  });

  it.each([401, 403])("文档检索身份失效 %s 不能降级", async (status) => {
    const error = new InternalApiError(status, status, "拒绝");
    const f = fixture(draft, { searchQuestions: vi.fn().mockRejectedValue(error) });
    await expect(dispatchTask("doc_draft", { topic: "进程调度" }, f.context)).rejects.toBe(error);
    expect(f.generate).toHaveBeenCalledTimes(1);
  });
});

describe("正文客户端契约", () => {
  it("只携带当前用户凭证并映射后端蛇形响应", async () => {
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => Response.json({ code: 200, data: {
      target_type: "answer", target_id: 12, author_id: 3, course_id: 2, title: "站内标题", body: "后端可见原文",
    }, message: "ok" }));
    const client = createInternalClient({
      baseUrl: "http://backend.test", token: "service", authorization: "Bearer current-user", fetchImpl,
    });
    expect(await client.fetchModerationTarget({ targetType: "answer", targetId: 12 }, asTraceId("trace"))).toEqual(content);
    expect(fetchImpl.mock.calls[0][0]).toBe("http://backend.test/internal/agent/user/moderation-targets/answer/12");
    const headers = new Headers(fetchImpl.mock.calls[0][1]?.headers);
    expect(headers.get("authorization")).toBe("Bearer current-user");
    expect(headers.get("x-service-token")).toBe("service");
  });

  it("拒绝后端返回与所请求目标不匹配的正文", async () => {
    const client = createInternalClient({
      baseUrl: "http://backend.test", token: "service", authorization: "Bearer current-user",
      fetchImpl: vi.fn(async () => Response.json({ code: 200, data: {
        target_type: "question", target_id: 99, author_id: 3, course_id: 2, title: "其他题", body: "其他正文",
      }, message: "ok" })),
    });
    await expect(client.fetchModerationTarget({ targetType: "answer", targetId: 12 }, asTraceId("trace"))).rejects.toThrow();
  });
});
