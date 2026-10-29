// 周报调度器测试（K-04，KN-R02）：逐课程生成、程序聚合数字与来源复核、
// 幂等 409 跳过、单课程失败隔离（X-07）、定时与启动补偿的纯函数行为。
import { afterEach, describe, expect, it, vi } from "vitest";
import { MockLanguageModelV4 } from "ai/test";

import { InternalApiError, type UserInternalClient } from "../src/internal-client";
import {
  aggregateReport,
  loadWeeklyReportConfig,
  nextOccurrence,
  runWeeklyReports,
  type WeeklyAnalysis,
} from "../src/scheduler/weekly-report";

const usage = {
  inputTokens: { total: 0, noCache: 0, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 0, text: 0, reasoning: 0 },
};
const generated = (data: unknown) => ({ content: [{ type: "text" as const,
  text: JSON.stringify(data) }],
  finishReason: { unified: "stop" as const, raw: undefined }, usage, warnings: [] });

const NODES = [{ id: 1, name: "进程" }, { id: 2, name: "线程" }];
const QUESTIONS = [
  { id: 11, title: "进程调度问题", body: "正文一", created_at: "2026-10-20T00:00:00Z" },
  { id: 12, title: "置换算法问题", body: "正文二", created_at: "2026-10-21T00:00:00Z" },
  { id: 13, title: "线程同步问题", body: "正文三", created_at: "2026-10-22T00:00:00Z" },
];

function fixtureClient(overrides: Partial<UserInternalClient> = {}) {
  return {
    audit: {
      createRun: vi.fn().mockResolvedValue({ id: 1, user_id: null, agent_run_id: "x",
        trace_id: "t", status: "running" }),
      recordEvent: vi.fn(),
      finishRun: vi.fn().mockResolvedValue({ id: 1, user_id: null, agent_run_id: "x",
        trace_id: "t", status: "succeeded" }),
    },
    fetchKnowledgeTreeCourses: vi.fn().mockResolvedValue([
      { course_id: 7, teacher_id: 3 }, { course_id: 8, teacher_id: 4 },
    ]),
    fetchKnowledgeTree: vi.fn().mockResolvedValue(NODES),
    fetchRecentQuestions: vi.fn().mockResolvedValue(QUESTIONS),
    saveWeeklyReport: vi.fn().mockResolvedValue({ id: 101 }),
    searchCourses: vi.fn(), searchQuestions: vi.fn(), fetchTags: vi.fn(),
    fetchModerationTarget: vi.fn(),
    ...overrides,
  } as unknown as UserInternalClient;
}

afterEach(() => { vi.restoreAllMocks(); });

it("周报正文接入后端匿名概括和聚合次数，不把事件送进模型", async () => {
  const privateSummary = "关于“递归”的学习疑问";
  const feedback = vi.fn().mockResolvedValue({ course_id: 7, items: [{
    tag_id: 8, tag_name: "递归", summary: privateSummary, count: 3,
    knowledge_node_ids: [1], question_links: ["/questions/11"],
  }] });
  const client = fixtureClient({
    fetchKnowledgeTreeCourses: vi.fn().mockResolvedValue([{ course_id: 7, teacher_id: 3 }]),
    fetchLearningFeedback: feedback,
  });
  const generate = vi.fn(async () => generated({
    mappings: [], uncovered_suggestions: [], summary: "教学建议。",
  }));
  const model = new MockLanguageModelV4({ doGenerate: generate });
  await runWeeklyReports({ createClient: () => client, getModel: () => model },
    { weekStart: new Date("2026-10-19T00:00:00Z") });
  expect(feedback).toHaveBeenCalled();
  const saved = vi.mocked(client.saveWeeklyReport).mock.calls[0][0];
  expect(saved.content).toContain("匿名学习反馈");
  expect(saved.content).toContain(privateSummary);
  expect(saved.content).toContain("3 次学习事件");
  expect(saved.content).toContain("/questions/11");
  expect(JSON.stringify(generate.mock.calls)).not.toContain(privateSummary);
});

describe("周报程序聚合", () => {
  it("热力与未覆盖计数来自有效映射；引用不存在问题/节点的映射被剔除", () => {
    const analysis: WeeklyAnalysis = {
      mappings: [
        { question_id: 11, node_id: 1, topic: "进程调度" },
        { question_id: 13, node_id: 2, topic: "线程同步" },
        { question_id: 13, node_id: 2, topic: "线程同步" },
        { question_id: 12, node_id: null, topic: "内存置换算法" },
        { question_id: 999, node_id: 1, topic: "伪造问题" },
        { question_id: 11, node_id: 999, topic: "伪造节点" },
      ],
      uncovered_suggestions: [
        { topic: "内存置换算法", suggestion: "建议补充页面置换章节" },
        { topic: "进程调度", suggestion: "该主题已覆盖，不应进入未覆盖" },
        { topic: "完全虚构主题", suggestion: "无映射支撑，应剔除" },
      ],
      summary: "本周提问集中在并发与内存管理。",
    };
    const report = aggregateReport(analysis, NODES, QUESTIONS);
    expect(report.question_count).toBe(3);
    expect(report.heatmap).toEqual([
      { node_id: 2, node_name: "线程", question_count: 2 },
      { node_id: 1, node_name: "进程", question_count: 1 },
    ]);
    expect(report.uncovered_topics).toEqual([
      { topic: "内存置换算法", question_count: 1, suggestion: "建议补充页面置换章节" },
    ]);
    expect(report.content).toContain("3 个提问");
    expect(report.content).toContain("2 个命中知识点");
    expect(report.content).toContain("1 个未覆盖主题");
  });

  it("零提问仍产出说明性周报", () => {
    const analysis: WeeklyAnalysis = { mappings: [], uncovered_suggestions: [], summary: "本周无提问。" };
    const report = aggregateReport(analysis, NODES, []);
    expect(report.question_count).toBe(0);
    expect(report.heatmap).toEqual([]);
    expect(report.uncovered_topics).toEqual([]);
    expect(report.content).toContain("0 个提问");
  });
});

describe("调度触发纯函数", () => {
  it("配置解析：默认开、周一 8 点；非法值回落默认", () => {
    expect(loadWeeklyReportConfig({})).toEqual({ enabled: true, dayOfWeek: 1, hour: 8 });
    expect(loadWeeklyReportConfig({ WEEKLY_REPORT_ENABLED: "false" }).enabled).toBe(false);
    expect(loadWeeklyReportConfig({ WEEKLY_REPORT_DAY: "9", WEEKLY_REPORT_HOUR: "25" }))
      .toEqual({ enabled: true, dayOfWeek: 1, hour: 8 });
    expect(loadWeeklyReportConfig({ WEEKLY_REPORT_DAY: "5", WEEKLY_REPORT_HOUR: "20" }))
      .toEqual({ enabled: true, dayOfWeek: 5, hour: 20 });
  });

  it("nextOccurrence：本周未过取本周，已过取下周", () => {
    const config = { enabled: true, dayOfWeek: 1, hour: 8 };
    // 2026-10-21 是周三：下周一为 10-26
    const wednesday = new Date(2026, 9, 21, 10, 0, 0);
    const next = nextOccurrence(config, wednesday);
    expect(next).toEqual(new Date(2026, 9, 26, 8, 0, 0));
    // 周一 07:00：本周触发未过，取当天 08:00
    const mondayMorning = new Date(2026, 9, 19, 7, 0, 0);
    expect(nextOccurrence(config, mondayMorning)).toEqual(new Date(2026, 9, 19, 8, 0, 0));
    // 周一 09:00：已过，取下周一
    const mondayLate = new Date(2026, 9, 19, 9, 0, 0);
    expect(nextOccurrence(config, mondayLate)).toEqual(new Date(2026, 9, 26, 8, 0, 0));
  });
});

describe("runWeeklyReports 逐课程生成", () => {
  it("真实问题标签和程序聚合频次进入模型，教学建议保存到教师周报正文", async () => {
    const tags = [{ id: 7, name: "并发", type: "tech" }];
    const client = fixtureClient({ fetchRecentQuestions: vi.fn().mockResolvedValue([
      { ...QUESTIONS[0], tags }, { ...QUESTIONS[1], tags },
    ]) });
    const generate = vi.fn(async (_options) => generated({ mappings: [], uncovered_suggestions: [], summary: "本期分析。",
      tag_focus: [{ tag_id: 7, question_ids: [11, 12], common_confusion: "互斥与同步容易混淆。",
        teaching_focus: "用线程交错执行例题对比两者，安排随堂练习。" }],
    }));
    const outcomes = await runWeeklyReports({ createClient: () => client,
      getModel: () => new MockLanguageModelV4({ doGenerate: generate }) });
    expect(outcomes.every((item) => item.status === "succeeded")).toBe(true);
    const prompt = JSON.parse(String(generate.mock.calls[0][0].prompt.find((message) => message.role === "user")?.content[0].text));
    expect(prompt.repeated_tags).toEqual([{ tag_id: 7, tag_name: "并发", question_count: 2, question_ids: [11, 12] }]);
    expect(prompt.questions[0].tags).toEqual(tags);
    const report = client.saveWeeklyReport.mock.calls[0][0];
    expect(report.content).toContain("并发：2 个不同问题");
    expect(report.content).toContain("教学侧重点：用线程交错执行例题对比两者，安排随堂练习。");
    expect(report.content.length).toBeLessThanOrEqual(20_000);
  });

  it("成功链路：审计无主运行、程序聚合保存、succeeded 终态", async () => {
    const client = fixtureClient();
    const analysis = {
      mappings: [
        { question_id: 11, node_id: 1, topic: "进程调度" },
        { question_id: 12, node_id: null, topic: "内存置换算法" },
      ],
      uncovered_suggestions: [{ topic: "内存置换算法", suggestion: "建议补充例题" }],
      summary: "并发主题提问集中。",
    };
    const generate = vi.fn(async () => generated(analysis));
    const outcomes = await runWeeklyReports({
      createClient: () => client,
      getModel: () => new MockLanguageModelV4({ doGenerate: generate }),
      now: () => new Date(2026, 9, 26, 8, 0, 0),
    });
    expect(outcomes).toHaveLength(2);
    expect(outcomes.every((item) => item.status === "succeeded")).toBe(true);
    // 每课程一次审计创建 + 保存 + 成功终态
    expect(client.audit.createRun).toHaveBeenCalledTimes(2);
    expect(client.saveWeeklyReport).toHaveBeenCalledTimes(2);
    expect(client.audit.finishRun.mock.calls.every((call) => call[1].status === "succeeded")).toBe(true);

    const body = client.saveWeeklyReport.mock.calls[0][0];
    expect(body.course_id).toBe(7);
    expect(body.week_start).toBe("2026-10-19");
    expect(body.week_end).toBe("2026-10-25");
    expect(body.question_count).toBe(3);
    expect(body.uncovered_topics[0]).toEqual({
      topic: "内存置换算法", question_count: 1, suggestion: "建议补充例题",
    });
    expect(body.heatmap).toEqual([{ node_id: 1, node_name: "进程", question_count: 1 }]);
    expect(body.agent_run_id).toEqual(client.audit.createRun.mock.calls[0][0].agent_run_id);
    // 分析提示含树与问题、不含凭证
    const prompt = JSON.stringify(generate.mock.calls[0][0].prompt);
    expect(prompt).toContain("进程调度问题");
    expect(prompt).toContain("knowledge_tree");
  });

  it("同周已存在（409）视为成功跳过，不阻塞下一课程", async () => {
    const client = fixtureClient({
      saveWeeklyReport: vi.fn()
        .mockRejectedValueOnce(new InternalApiError(409, 409, "already exists"))
        .mockResolvedValue({ id: 102 }),
    });
    const generate = vi.fn(async () => generated({
      mappings: [], uncovered_suggestions: [], summary: "无",
    }));
    const outcomes = await runWeeklyReports({
      createClient: () => client,
      getModel: () => new MockLanguageModelV4({ doGenerate: generate }),
    });
    expect(outcomes[0]).toMatchObject({ courseId: 7, status: "succeeded", summary: "本周周报已存在" });
    expect(outcomes[1]).toMatchObject({ courseId: 8, status: "succeeded" });
    expect(client.saveWeeklyReport).toHaveBeenCalledTimes(2);
  });

  it("单课程模型失败记录 failed 并继续下一课程（X-07）", async () => {
    const client = fixtureClient();
    const generate = vi.fn()
      .mockRejectedValueOnce(new Error("model down"))
      .mockResolvedValueOnce(generated({ mappings: [], uncovered_suggestions: [], summary: "ok" }));
    const outcomes = await runWeeklyReports({
      createClient: () => client,
      getModel: () => new MockLanguageModelV4({ doGenerate: generate }),
    });
    expect(outcomes[0]).toMatchObject({ courseId: 7, status: "failed", summary: "模型或后端故障" });
    expect(outcomes[1]).toMatchObject({ courseId: 8, status: "succeeded" });
    expect(client.audit.finishRun.mock.calls[0][1]).toMatchObject({ status: "failed" });
    expect(client.audit.finishRun.mock.calls[1][1]).toMatchObject({ status: "succeeded" });
  });

  it("无树课程防御性跳过（E-19），不调用模型与保存", async () => {
    const client = fixtureClient({ fetchKnowledgeTree: vi.fn().mockResolvedValue([]) });
    const generate = vi.fn(async () => generated({ mappings: [], uncovered_suggestions: [], summary: "x" }));
    const outcomes = await runWeeklyReports({
      createClient: () => client,
      getModel: () => new MockLanguageModelV4({ doGenerate: generate }),
    });
    expect(outcomes.every((item) => item.status === "skipped")).toBe(true);
    expect(generate).not.toHaveBeenCalled();
    expect(client.saveWeeklyReport).not.toHaveBeenCalled();
    expect(client.audit.finishRun.mock.calls.every((call) => call[1].status === "succeeded")).toBe(true);
  });

  it("模型未配置时整轮跳过，不产生运行记录", async () => {
    const client = fixtureClient();
    const outcomes = await runWeeklyReports({
      createClient: () => client,
      getModel: () => { throw new Error("ModelNotConfiguredError"); },
    });
    expect(outcomes).toEqual([]);
    expect(client.fetchKnowledgeTreeCourses).not.toHaveBeenCalled();
  });
});
