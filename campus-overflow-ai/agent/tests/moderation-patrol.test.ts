// 静默巡检调度器测试（T-15-B，US-13）：逐条评估、中高险建单、幂等跳过、
// 单条失败隔离（X-05）、低风险不打扰、整轮失败不阻塞下轮。
import { afterEach, describe, expect, it, vi } from "vitest";
import { MockLanguageModelV4 } from "ai/test";

import { InternalApiError, type UserInternalClient } from "../src/internal-client";
import {
  loadPatrolConfig,
  runModerationPatrol,
  type PatrolVerdict,
} from "../src/scheduler/moderation-patrol";

const usage = {
  inputTokens: { total: 0, noCache: 0, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 0, text: 0, reasoning: 0 },
};
const generated = (data: unknown) => ({ content: [{ type: "text" as const,
  text: JSON.stringify(data) }],
  finishReason: { unified: "stop" as const, raw: undefined }, usage, warnings: [] });

const verdict = (overrides: Partial<PatrolVerdict> = {}): PatrolVerdict => ({
  riskLevel: "low", shouldEscalate: false,
  reason: "内容无风险", ...overrides,
});

const CONTENTS = [
  { target_type: "question", target_id: 1, body: "问题正文一", author_id: 5, course_id: 2 },
  { target_type: "answer", target_id: 2, body: "回答正文二", author_id: 6, course_id: 2 },
  { target_type: "comment", target_id: 3, body: "评论正文三", author_id: 7, course_id: null },
] as const;

function fixtureClient() {
  return {
    audit: {
      createRun: vi.fn().mockResolvedValue({ id: 1, user_id: null, agent_run_id: "x",
        trace_id: "t", status: "running" }),
      recordEvent: vi.fn(),
      finishRun: vi.fn().mockResolvedValue({ id: 1, user_id: null, agent_run_id: "x",
        trace_id: "t", status: "succeeded" }),
    },
    fetchPatrolContents: vi.fn().mockResolvedValue(CONTENTS),
    createPatrolCase: vi.fn().mockResolvedValue({ repeat: false }),
    fetchKnowledgeTreeCourses: vi.fn(), fetchKnowledgeTree: vi.fn(),
    fetchRecentQuestions: vi.fn(), saveWeeklyReport: vi.fn(),
    searchCourses: vi.fn(), searchQuestions: vi.fn(), fetchTags: vi.fn(),
    fetchModerationTarget: vi.fn(),
  } as unknown as UserInternalClient;
}

afterEach(() => { vi.restoreAllMocks(); });

describe("静默巡检调度器", () => {
  it("配置解析：默认开、15 分钟；非法值回落", () => {
    expect(loadPatrolConfig({})).toEqual({ enabled: true, intervalMinutes: 15 });
    expect(loadPatrolConfig({ MODERATION_PATROL_ENABLED: "false" }).enabled).toBe(false);
    expect(loadPatrolConfig({ MODERATION_PATROL_INTERVAL_MINUTES: "3" }).intervalMinutes).toBe(15);
    expect(loadPatrolConfig({ MODERATION_PATROL_INTERVAL_MINUTES: "30" }).intervalMinutes).toBe(30);
  });

  it("中高险且建议复核建单：pending 工单带快照/原因/trace，审计 succeeded", async () => {
    const client = fixtureClient();
    const generate = vi.fn()
      .mockResolvedValueOnce(generated(verdict({ riskLevel: "high", shouldEscalate: true, reason: "辱骂攻击" })))
      .mockResolvedValueOnce(generated(verdict({ riskLevel: "medium", shouldEscalate: true, reason: "疑似广告" })))
      .mockResolvedValueOnce(generated(verdict()));
    const outcomes = await runModerationPatrol({
      createClient: () => client,
      getModel: () => new MockLanguageModelV4({ doGenerate: generate }),
    });
    expect(outcomes).toEqual({ scanned: 3, escalated: 2, skipped: 1, failed: 0 });
    expect(client.createPatrolCase).toHaveBeenCalledTimes(2);
    const firstCall = client.createPatrolCase.mock.calls[0];
    expect(firstCall[0]).toMatchObject({
      target_type: "question", target_id: 1, risk_level: "high", reason: "辱骂攻击",
    });
    expect(firstCall[0].snapshot).toContain("question#1");
    expect(firstCall[0].agent_run_id).toEqual(client.audit.createRun.mock.calls[0][0].agent_run_id);
    expect(client.audit.finishRun.mock.calls[0][1]).toMatchObject({
      status: "succeeded", output_summary: expect.stringContaining("升级 2 条"),
    });
    // 扫描提示含目标与正文（评估依据），且系统提示声明无处置权（C-06）
    const scanPrompt = JSON.stringify(generate.mock.calls[0][0]);
    expect(scanPrompt).toContain("问题正文一");
  });

  it("低风险或不建议复核仅跳过，不建单", async () => {
    const client = fixtureClient();
    const generate = vi.fn().mockResolvedValue(generated(verdict()));
    const outcomes = await runModerationPatrol({
      createClient: () => client,
      getModel: () => new MockLanguageModelV4({ doGenerate: generate }),
    });
    expect(outcomes).toEqual({ scanned: 3, escalated: 0, skipped: 3, failed: 0 });
    expect(client.createPatrolCase).not.toHaveBeenCalled();
  });

  it("同目标已有未结案工单（repeat=true）计为升级但幂等", async () => {
    const client = fixtureClient();
    (client.createPatrolCase as ReturnType<typeof vi.fn>).mockResolvedValue({ repeat: true });
    const generate = vi.fn().mockResolvedValue(
      generated(verdict({ riskLevel: "high", shouldEscalate: true, reason: "重复违规" })),
    );
    const outcomes = await runModerationPatrol({
      createClient: () => client,
      getModel: () => new MockLanguageModelV4({ doGenerate: generate }),
    });
    // 3 条全部命中但后端判重 repeat：全部计升级、无失败（幂等语义）
    expect(outcomes.escalated).toBe(3);
    expect(outcomes.failed).toBe(0);
  });

  it("单条失败隔离：建单接口 503 不阻塞其余目标（X-05）", async () => {
    const client = fixtureClient();
    (client.createPatrolCase as ReturnType<typeof vi.fn>)
      .mockRejectedValueOnce(new InternalApiError(503, 503, "backend down"))
      .mockResolvedValue({ repeat: false });
    const generate = vi.fn().mockResolvedValue(
      generated(verdict({ riskLevel: "high", shouldEscalate: true, reason: "违规" })),
    );
    const outcomes = await runModerationPatrol({
      createClient: () => client,
      getModel: () => new MockLanguageModelV4({ doGenerate: generate }),
    });
    // 3 条全命中：首条 503 失败计 failed，其余 2 条成功计升级——失败不阻塞（X-05）
    expect(outcomes).toEqual({ scanned: 3, escalated: 2, skipped: 0, failed: 1 });
    expect(client.audit.finishRun.mock.calls[0][1].status).toBe("succeeded");
  });

  it("清单读取失败整轮 failed 终态，不假报成功", async () => {
    const client = fixtureClient();
    (client.fetchPatrolContents as ReturnType<typeof vi.fn>)
      .mockRejectedValue(new InternalApiError(503, 503, "backend down"));
    const generate = vi.fn();
    const outcomes = await runModerationPatrol({
      createClient: () => client,
      getModel: () => new MockLanguageModelV4({ doGenerate: generate }),
    });
    expect(outcomes).toEqual({ scanned: 0, escalated: 0, skipped: 0, failed: 0 });
    expect(client.audit.finishRun.mock.calls[0][1]).toMatchObject({
      status: "failed", error_summary: "巡检清单读取失败",
    });
    expect(generate).not.toHaveBeenCalled();
  });

  it("模型未配置时整轮跳过，不创建运行", async () => {
    const client = fixtureClient();
    const outcomes = await runModerationPatrol({
      createClient: () => client,
      getModel: () => { throw new Error("ModelNotConfiguredError"); },
    });
    expect(outcomes.scanned).toBe(0);
    expect(client.audit.createRun).not.toHaveBeenCalled();
  });
});
