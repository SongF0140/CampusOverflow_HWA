// 教师周报调度器（KN-R02，Q-09③：系统每周自动生成）。
// 单实例进程内定时器：默认每周一 08:00 本地时区触发；启动时若本周触发时刻已过则补偿
// 跑一次（周报同周唯一 + 后端 409 幂等，重启不重复生成，E-18）。
// 逐课程生成：服务级无主运行审计（G-04-A 旧服务入口）→ 拉树与近 7 天问题 →
// LLM 语义映射 → 程序聚合数字与来源复核 → 保存周报；单课程失败记录并继续（X-07）。
import { randomUUID } from "node:crypto";
import type { LanguageModel } from "ai";
import { z } from "zod";

import { createLanguageModel } from "../config.js";
import { InternalApiError, type RecentQuestionItem, type UserInternalClient } from "../internal-client.js";
import { generateStructured } from "../loop/self-check.js";
import { asTraceId } from "../types/index.js";

export const TEACHING_REPORT_TASK_TYPE = "teaching_report";
const LOOKBACK_DAYS = 7;
const MODEL_DEADLINE_MS = 60_000;

export interface WeeklyReportConfig {
  enabled: boolean;
  /** 触发星期：1=周一 … 7=周日 */
  dayOfWeek: number;
  hour: number;
}

export const loadWeeklyReportConfig = (env: NodeJS.ProcessEnv = process.env): WeeklyReportConfig => {
  const day = Number(env.WEEKLY_REPORT_DAY ?? 1);
  const hour = Number(env.WEEKLY_REPORT_HOUR ?? 8);
  return {
    enabled: (env.WEEKLY_REPORT_ENABLED ?? "true") !== "false",
    dayOfWeek: Number.isInteger(day) && day >= 1 && day <= 7 ? day : 1,
    hour: Number.isInteger(hour) && hour >= 0 && hour <= 23 ? hour : 8,
  };
};

/** 下一次触发时刻：本周 dayOfWeek 的 hour:00 未过则本周，否则下周（本地时区） */
export const nextOccurrence = (config: WeeklyReportConfig, from: Date): Date => {
  const next = new Date(from);
  next.setHours(config.hour, 0, 0, 0);
  const currentDay = next.getDay() === 0 ? 7 : next.getDay();
  let delta = config.dayOfWeek - currentDay;
  if (delta < 0 || (delta === 0 && next.getTime() <= from.getTime())) delta += 7;
  next.setDate(next.getDate() + delta);
  return next;
};

/** LLM 原始分析：只做语义分类；全部计数由程序聚合，不信任模型数字 */
export const WeeklyAnalysisSchema = z.object({
  mappings: z
    .array(
      z.object({
        question_id: z.number().int().positive(),
        node_id: z.number().int().positive().nullable(),
        topic: z.string().min(1).max(100),
      }),
    )
    .max(200),
  uncovered_suggestions: z
    .array(
      z.object({
        topic: z.string().min(1).max(100),
        suggestion: z.string().min(1).max(500),
      }),
    )
    .max(50),
  summary: z.string().min(1).max(2000),
});
export type WeeklyAnalysis = z.infer<typeof WeeklyAnalysisSchema>;

const ANALYSIS_SYSTEM = `你是高校课程的教学分析助手。输入是课程知识树的知识点清单与本周期内的学生问题列表。对每个问题判断其最相关的知识点（node_id，无法对应任何知识点时为 null）并提炼一个简短主题（topic）。对提问集中但知识树未覆盖的主题给出拓宽建议。所有计数由系统统计，你不需要输出数字。不得在输出中出现密钥、口令、凭证类字样或学生原文。`;

export interface AggregatedReport {
  content: string;
  uncovered_topics: Array<{ topic: string; question_count: number; suggestion: string }>;
  heatmap: Array<{ node_id: number; node_name: string; question_count: number }>;
  question_count: number;
}

/** 程序聚合：剔除引用不存在问题/节点的映射；热力与未覆盖计数全部来自有效映射 */
export const aggregateReport = (
  analysis: WeeklyAnalysis,
  nodes: ReadonlyArray<{ id: number; name: string }>,
  questions: readonly RecentQuestionItem[],
): AggregatedReport => {
  const questionIds = new Set(questions.map((question) => question.id));
  const nodeNames = new Map(nodes.map((node) => [node.id, node.name]));
  const mappings = analysis.mappings.filter(
    (mapping) => questionIds.has(mapping.question_id)
      && (mapping.node_id === null || nodeNames.has(mapping.node_id)),
  );
  const heatCounts = new Map<number, number>();
  const topicStats = new Map<string, { total: number; covered: number }>();
  for (const mapping of mappings) {
    if (mapping.node_id !== null) {
      heatCounts.set(mapping.node_id, (heatCounts.get(mapping.node_id) ?? 0) + 1);
    }
    const stats = topicStats.get(mapping.topic) ?? { total: 0, covered: 0 };
    stats.total += 1;
    if (mapping.node_id !== null) stats.covered += 1;
    topicStats.set(mapping.topic, stats);
  }
  const heatmap = Array.from(heatCounts.entries())
    .map(([node_id, count]) => ({ node_id, node_name: nodeNames.get(node_id) ?? "", question_count: count }))
    .sort((a, b) => b.question_count - a.question_count || a.node_id - b.node_id);
  const uncovered_topics = analysis.uncovered_suggestions
    .filter((suggestion) => {
      const stats = topicStats.get(suggestion.topic);
      return stats !== undefined && stats.covered === 0;
    })
    .map((suggestion) => ({
      topic: suggestion.topic,
      question_count: topicStats.get(suggestion.topic)?.total ?? 0,
      suggestion: suggestion.suggestion,
    }))
    .sort((a, b) => b.question_count - a.question_count || a.topic.localeCompare(b.topic));
  const coveredQuestions = new Set(mappings.filter((m) => m.node_id !== null).map((m) => m.question_id)).size;
  const content = `${analysis.summary}\n\n本周共 ${questions.length} 个提问，${coveredQuestions} 个命中知识点，${uncovered_topics.length} 个未覆盖主题。`;
  return { content, uncovered_topics, heatmap, question_count: questions.length };
};

export interface WeeklyReportDeps {
  createClient: () => UserInternalClient;
  getModel?: () => LanguageModel;
  now?: () => Date;
}

export interface CourseReportOutcome {
  courseId: number;
  status: "succeeded" | "failed" | "skipped";
  summary: string;
}

const failureSummary = (error: unknown): string => {
  if (error instanceof InternalApiError && error.status === 409) return "本周周报已存在";
  if (error instanceof InternalApiError && (error.status === 401 || error.status === 403)) {
    return "服务凭证被后端拒绝";
  }
  return "模型或后端故障";
};

const finishRun = async (
  client: UserInternalClient, runId: string, trace: string,
  status: "succeeded" | "failed", summary: string,
): Promise<void> => {
  try {
    await client.audit.finishRun(runId, status === "succeeded"
      ? { status, output_summary: summary }
      : { status, error_summary: summary }, asTraceId(trace));
  } catch (error) {
    console.error(JSON.stringify({ event: "weekly_report_finish_failed", agent_run_id: runId,
      reason: error instanceof Error ? error.name : "unknown" }));
  }
};

const toDateString = (value: Date): string => {
  const year = value.getFullYear();
  const month = `${value.getMonth() + 1}`.padStart(2, "0");
  const day = `${value.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const generateForCourse = async (
  client: UserInternalClient, model: LanguageModel,
  course: { course_id: number }, weekStart: Date,
): Promise<CourseReportOutcome> => {
  const runId = randomUUID();
  const trace = randomUUID();
  const courseId = course.course_id;
  try {
    await client.audit.createRun(
      { agent_run_id: runId, task_type: TEACHING_REPORT_TASK_TYPE,
        input_summary: `系统周报：课程 ${courseId}` },
      asTraceId(trace),
    );
    const nodes = await client.fetchKnowledgeTree({ courseId }, asTraceId(trace));
    if (nodes.length === 0) {
      // E-19 防御：无树课程不生成（清单接口已过滤，此处兜底）
      await finishRun(client, runId, trace, "succeeded", "课程暂无知识树，跳过");
      return { courseId, status: "skipped", summary: "课程暂无知识树" };
    }
    const questions = await client.fetchRecentQuestions(
      { courseId, days: LOOKBACK_DAYS, limit: 200 }, asTraceId(trace),
    );
    const analysis = await generateStructured({
      model,
      schema: WeeklyAnalysisSchema,
      system: ANALYSIS_SYSTEM,
      prompt: JSON.stringify({
        knowledge_tree: nodes.map((node) => ({ node_id: node.id, name: node.name })),
        questions: questions.map((question) => ({
          question_id: question.id, title: question.title, body: question.body,
        })),
      }),
      signal: AbortSignal.timeout(MODEL_DEADLINE_MS),
      maxRetries: 0,
    });
    const aggregated = aggregateReport(analysis, nodes, questions);
    const weekEndDate = new Date(weekStart);
    weekEndDate.setDate(weekEndDate.getDate() + LOOKBACK_DAYS - 1);
    await client.saveWeeklyReport({
      course_id: courseId,
      week_start: toDateString(weekStart),
      week_end: toDateString(weekEndDate),
      content: aggregated.content,
      uncovered_topics: aggregated.uncovered_topics,
      heatmap: aggregated.heatmap,
      question_count: aggregated.question_count,
      agent_run_id: runId,
    }, asTraceId(trace));
    await finishRun(client, runId, trace, "succeeded", "周报已生成");
    return { courseId, status: "succeeded", summary: "周报已生成" };
  } catch (error) {
    // 单课程失败不阻塞其他课程（X-07）；409 = 本周已存在，视为成功跳过
    const alreadyExists = error instanceof InternalApiError && error.status === 409;
    const summary = failureSummary(error);
    await finishRun(client, runId, trace, alreadyExists ? "succeeded" : "failed", summary);
    return {
      courseId,
      status: alreadyExists ? "succeeded" : "failed",
      summary: alreadyExists ? "本周周报已存在" : summary,
    };
  }
};

/** 触发一次全量周报生成（幂等：后端同周唯一 + 409 兜底） */
export const runWeeklyReports = async (
  deps: WeeklyReportDeps, options: { weekStart?: Date } = {},
): Promise<CourseReportOutcome[]> => {
  let model: LanguageModel;
  try {
    model = deps.getModel?.() ?? createLanguageModel();
  } catch (error) {
    console.error(JSON.stringify({ event: "weekly_report_model_unavailable",
      reason: error instanceof Error ? error.name : "unknown" }));
    return [];
  }
  const client = deps.createClient();
  const now = deps.now ?? (() => new Date());
  const weekStart = options.weekStart ?? (() => {
    const date = new Date(now());
    date.setDate(date.getDate() - LOOKBACK_DAYS);
    return date;
  })();
  const trace = asTraceId(randomUUID());
  const courses = await client.fetchKnowledgeTreeCourses(trace);
  const outcomes: CourseReportOutcome[] = [];
  for (const course of courses) {
    outcomes.push(await generateForCourse(client, model, course, weekStart));
  }
  return outcomes;
};

/** 启动调度器，返回停止函数；未启用时为空操作 */
export const startWeeklyReportScheduler = (deps: WeeklyReportDeps): (() => void) => {
  const config = loadWeeklyReportConfig();
  if (!config.enabled) return () => undefined;
  const now = deps.now ?? (() => new Date());
  let stopped = false;
  let timer: NodeJS.Timeout | undefined;

  const fire = async (): Promise<void> => {
    if (stopped) return;
    try {
      await runWeeklyReports(deps);
    } catch (error) {
      console.error(JSON.stringify({ event: "weekly_report_cycle_failed",
        reason: error instanceof Error ? error.name : "unknown" }));
    }
    if (!stopped) scheduleNext();
  };
  const scheduleNext = (): void => {
    const delay = Math.max(0, nextOccurrence(config, now()).getTime() - now().getTime());
    timer = setTimeout(() => { void fire(); }, delay);
  };
  // 启动补偿：nextOccurrence 距今超过 6 天说明本周触发时刻已过（算出的是下周），
  // 30 秒后补跑一次（后端同周唯一 + 409 幂等防重复，E-18）
  const first = nextOccurrence(config, now());
  if (first.getTime() - now().getTime() > 6 * 24 * 60 * 60 * 1000) {
    timer = setTimeout(() => { void fire(); }, 30_000);
  } else {
    scheduleNext();
  }
  return () => {
    stopped = true;
    if (timer !== undefined) clearTimeout(timer);
  };
};
