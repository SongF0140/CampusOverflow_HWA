// 静默巡检调度器（US-13 静默检测，T-15-B）。
// 周期性扫描全站时间窗内新内容 → 逐条 LLM 风险评估（服务级无主运行审计）→
// 中高风险且 shouldEscalate 经内部接口建 pending 工单（快照+原因+trace，C-06 只建单不处置）；
// 同目标已有未结案工单幂等跳过；单条失败记录并继续（X-05/X-07 精神）。
// 低风险仅记审计摘要（US-13"低风险打标"的运行级留痕，内容列回填归后续批次）。
import { randomUUID } from "node:crypto";
import type { LanguageModel } from "ai";
import { z } from "zod";

import { createLanguageModel } from "../config.js";
import {
  InternalApiError,
  type PatrolContentItem,
  type UserInternalClient,
} from "../internal-client.js";
import { generateStructured } from "../loop/self-check.js";
import { asTraceId } from "../types/index.js";
import type { SecurityHooks } from "../security/contracts.js";
import { executeThroughGateway } from "../tools/execution-gateway.js";

export const PATROL_TASK_TYPE = "moderation_patrol";
const SCAN_WINDOW_HOURS = 1;
const SCAN_LIMIT = 100;
const MODEL_DEADLINE_MS = 60_000;

export interface PatrolConfig {
  enabled: boolean;
  intervalMinutes: number;
}

export const loadPatrolConfig = (env: NodeJS.ProcessEnv = process.env): PatrolConfig => {
  const minutes = Number(env.MODERATION_PATROL_INTERVAL_MINUTES ?? 15);
  return {
    enabled: (env.MODERATION_PATROL_ENABLED ?? "true") !== "false",
    intervalMinutes: Number.isInteger(minutes) && minutes >= 5 && minutes <= 1440 ? minutes : 15,
  };
};

/** LLM 风险评估输出：仅分级与判断，不产生处置（C-06） */
export const PatrolVerdictSchema = z.object({
  riskLevel: z.enum(["low", "medium", "high"]),
  shouldEscalate: z.boolean(),
  reason: z.string().min(1).max(500),
});
export type PatrolVerdict = z.infer<typeof PatrolVerdictSchema>;

const PATROL_SYSTEM = `你是高校课程问答平台的内容风险巡检助手。逐条评估给定内容是否存在辱骂攻击、垃圾广告、泄露隐私、违法违规等风险。只输出 riskLevel（low/medium/high）、shouldEscalate（是否建议人工复核）与简短中文理由。你不具有任何处置权限；理由中不得复述内容原文，不得出现密钥、口令、凭证类字样。`;

export interface PatrolDeps {
  createClient: () => UserInternalClient;
  getModel?: () => LanguageModel;
  hooks?: SecurityHooks;
}

export interface PatrolOutcome {
  scanned: number;
  escalated: number;
  skipped: number;
  failed: number;
}

const finishRun = async (
  client: UserInternalClient, runId: string, trace: string,
  status: "succeeded" | "failed", summary: string,
): Promise<void> => {
  try {
    await client.audit.finishRun(runId, status === "succeeded"
      ? { status, output_summary: summary }
      : { status, error_summary: summary }, asTraceId(trace));
  } catch (error) {
    console.error(JSON.stringify({ event: "patrol_finish_failed", agent_run_id: runId,
      reason: error instanceof Error ? error.name : "unknown" }));
  }
};

/** 快照：正文截断摘要（200 字符内），不含作者身份等隐私字段 */
const buildSnapshot = (content: PatrolContentItem): string =>
  `${content.target_type}#${content.target_id} course=${content.course_id ?? "none"} `
    + `body=${content.body.slice(0, 180)}`;

/** 单条内容评估与建单；返回 escalated / skipped / failed */
const evaluateContent = async (
  client: UserInternalClient, model: LanguageModel,
  content: PatrolContentItem, runId: string,
  hooks?: SecurityHooks,
): Promise<"escalated" | "skipped" | "failed"> => {
  const trace = randomUUID();
  try {
    const verdict = await generateStructured({
      model,
      schema: PatrolVerdictSchema,
      system: PATROL_SYSTEM,
      prompt: JSON.stringify({
        target_type: content.target_type,
        target_id: content.target_id,
        course_id: content.course_id,
        content: content.body,
      }),
      signal: AbortSignal.timeout(MODEL_DEADLINE_MS),
      maxRetries: 0,
    });
    if (verdict.riskLevel === "low" || !verdict.shouldEscalate) {
      // 低风险/不建议复核：仅运行级留痕（US-13"低风险打标"的调度侧形态）
      return "skipped";
    }
    const input = {
      target_type: content.target_type,
      target_id: content.target_id,
      risk_level: verdict.riskLevel,
      reason: verdict.reason,
      snapshot: buildSnapshot(content),
      agent_run_id: runId,
    };
    await executeThroughGateway({ name: "createPatrolCase", risk: "low", input, hooks,
      context: { source: "patrol", traceId: trace },
      execute: () => client.createPatrolCase(input, asTraceId(trace)),
    });
    return "escalated";
  } catch (error) {
    // 409/幂等重复不该出现（接口用 repeat 表达），但权限失效等失败不阻塞其余目标
    console.error(JSON.stringify({ event: "patrol_item_failed",
      target_type: content.target_type, target_id: content.target_id,
      reason: error instanceof InternalApiError ? `api-${error.status}`
        : error instanceof Error ? error.name : "unknown" }));
    return "failed";
  }
};

/** 执行一轮巡检：服务级无主运行审计贯穿整轮 */
export const runModerationPatrol = async (deps: PatrolDeps): Promise<PatrolOutcome> => {
  let model: LanguageModel;
  try {
    model = deps.getModel?.() ?? createLanguageModel();
  } catch (error) {
    console.error(JSON.stringify({ event: "patrol_model_unavailable",
      reason: error instanceof Error ? error.name : "unknown" }));
    return { scanned: 0, escalated: 0, skipped: 0, failed: 0 };
  }
  const client = deps.createClient();
  const runId = randomUUID();
  const trace = randomUUID();
  try {
    await client.audit.createRun(
      { agent_run_id: runId, task_type: PATROL_TASK_TYPE,
        input_summary: `静默巡检：近 ${SCAN_WINDOW_HOURS} 小时新内容` },
      asTraceId(trace),
    );
    const contents = await executeThroughGateway({ name: "fetchPatrolContents", risk: "low", input: {}, hooks: deps.hooks,
      context: { source: "patrol", traceId: trace },
      execute: () => client.fetchPatrolContents({ hours: SCAN_WINDOW_HOURS, limit: SCAN_LIMIT }, asTraceId(trace)),
    });
    const outcome: PatrolOutcome = { scanned: contents.length, escalated: 0, skipped: 0, failed: 0 };
    for (const content of contents) {
      const result = await evaluateContent(client, model, content, runId, deps.hooks);
      if (result === "escalated") outcome.escalated += 1;
      else if (result === "failed") outcome.failed += 1;
      else outcome.skipped += 1;
    }
    await finishRun(client, runId, trace, "succeeded",
      `扫描 ${outcome.scanned} 条，升级 ${outcome.escalated} 条，失败 ${outcome.failed} 条`);
    return outcome;
  } catch (error) {
    // 清单读取失败等整轮错误：终态 failed，下个周期重试（X-05）
    await finishRun(client, runId, trace, "failed", "巡检清单读取失败");
    console.error(JSON.stringify({ event: "patrol_cycle_failed",
      reason: error instanceof Error ? error.name : "unknown" }));
    return { scanned: 0, escalated: 0, skipped: 0, failed: 0 };
  }
};

/** 启动巡检调度器，返回停止函数；未启用时为空操作 */
export const startModerationPatrolScheduler = (deps: PatrolDeps): (() => void) => {
  const config = loadPatrolConfig();
  if (!config.enabled) return () => undefined;
  let stopped = false;
  const run = async (): Promise<void> => {
    if (stopped) return;
    await runModerationPatrol(deps);
    if (!stopped) timer = setTimeout(() => { void run(); }, config.intervalMinutes * 60_000);
  };
  let timer: NodeJS.Timeout | undefined = setTimeout(() => { void run(); }, 30_000);
  return () => {
    stopped = true;
    if (timer !== undefined) clearTimeout(timer);
  };
};
