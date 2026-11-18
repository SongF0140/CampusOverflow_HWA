// 夜间离线整理（N-1）：只读工单判定与管理员最终处置，产出误报/漏报/规则失效笔记。
// 不调用模型、不修改工单、不产生处置；笔记只含脱敏摘要与来源标识（C-06/C-07）。
// 触发方式：手动内部路由，默认关闭；后续 N-2 再接入定时与过期降级。
import { randomUUID } from "node:crypto";

import type { PatrolFeedbackItem, PatrolNoteInput, UserInternalClient } from "../internal-client.js";
import { asTraceId, type TraceId } from "../types/index.js";

export const CONSOLIDATION_TASK_TYPE = "patrol_consolidation";
export const CONSOLIDATION_RULE_VERSION = "patrol-n1-v1";
export const CONSOLIDATION_MODEL_VERSION = "deterministic";

const DEFAULT_DAYS = 14;
const DEFAULT_LIMIT = 200;
const MAX_NOTES = 5;
const VALID_DAYS = 30;
const MIN_GROUP_SAMPLE = 5;
const DEGRADATION_RATIO = 0.5;
const STALE_PENDING_DAYS = 7;
const FOCUS_MIN_SAMPLE = 5;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface ConsolidationOptions {
  now?: Date;
  validDays?: number;
  maxNotes?: number;
  ruleVersion?: string;
  modelVersion?: string;
}

export interface ConsolidationOutcome {
  analyzed: number;
  notes: number;
  repeated: number;
  expired: number;
}

export interface ConsolidationDeps {
  client: UserInternalClient;
  days?: number;
  limit?: number;
  traceId?: TraceId;
}

/** 管理员否决巡检建单：rejected 或处置为 skip / ignore */
const isFalsePositive = (item: PatrolFeedbackItem): boolean =>
  item.status === "rejected" || item.resolution === "skip" || item.resolution === "ignore";

const isPending = (item: PatrolFeedbackItem): boolean =>
  item.status === "pending" || item.status === "agent_proposed";

const groupKey = (item: PatrolFeedbackItem): string =>
  `${item.target_type}:${item.risk_level}`;

const noteSuffix = (item: PatrolFeedbackItem): string =>
  `${item.target_type}#${item.target_id} risk=${item.risk_level} outcome=${item.status}/${item.resolution ?? "-"}`;

const bump = (counts: Map<string, number>, key: string): void => {
  counts.set(key, (counts.get(key) ?? 0) + 1);
};

/** 只用于判断"长期未处置"，无法解析的时间按 0 天计 */
const ageDays = (iso: string, now: Date): number => {
  const time = Date.parse(iso);
  return Number.isNaN(time) ? 0 : Math.floor((now.getTime() - time) / DAY_MS);
};

/** 纯函数：由反馈数据生成笔记；便于单测且不依赖时间与网络 */
export const buildPatrolNotes = (
  feedback: PatrolFeedbackItem[],
  options: ConsolidationOptions = {},
): PatrolNoteInput[] => {
  const now = options.now ?? new Date();
  const validDays = options.validDays ?? VALID_DAYS;
  const maxNotes = options.maxNotes ?? MAX_NOTES;
  const ruleVersion = options.ruleVersion ?? CONSOLIDATION_RULE_VERSION;
  const modelVersion = options.modelVersion ?? CONSOLIDATION_MODEL_VERSION;
  const validUntil = new Date(now.getTime() + validDays * DAY_MS).toISOString();
  const base = { rule_version: ruleVersion, model_version: modelVersion, valid_until: validUntil };
  const notes = new Map<string, PatrolNoteInput>();

  // 同类模式计数：单条误报只是线索，重复出现才允许提升为可注入经验
  const falsePositiveCounts = new Map<string, number>();
  const missedCounts = new Map<string, number>();
  for (const item of feedback) {
    if (item.source === "agent" && isFalsePositive(item)) {
      bump(falsePositiveCounts, groupKey(item));
    }
    if (item.source === "admin" && item.status === "executed") {
      bump(missedCounts, groupKey(item));
    }
  }

  for (const item of feedback) {
    if (item.source === "agent" && isFalsePositive(item)) {
      notes.set(`false_positive:${item.case_id}:${ruleVersion}`, {
        ...base,
        note_key: `false_positive:${item.case_id}:${ruleVersion}`,
        note_type: "false_positive",
        source_case_id: item.case_id,
        target_type: item.target_type,
        target_id: item.target_id,
        summary: `巡检误报：case#${item.case_id} ${noteSuffix(item)}`,
        confidence: item.status === "rejected" ? 90 : 80,
        evidence_count: falsePositiveCounts.get(groupKey(item)) ?? 1,
      });
      continue;
    }
    if (item.source === "admin" && item.status === "executed") {
      notes.set(`missed_case:${item.case_id}:${ruleVersion}`, {
        ...base,
        note_key: `missed_case:${item.case_id}:${ruleVersion}`,
        note_type: "missed_case",
        source_case_id: item.case_id,
        target_type: item.target_type,
        target_id: item.target_id,
        summary: `巡检漏报线索：管理员直接处置 case#${item.case_id} ${noteSuffix(item)}`,
        confidence: 70,
        evidence_count: missedCounts.get(groupKey(item)) ?? 1,
      });
    }
  }

  const groups = new Map<string, { total: number; negative: number }>();
  for (const item of feedback) {
    if (item.source !== "agent") continue;
    const key = groupKey(item);
    const group = groups.get(key) ?? { total: 0, negative: 0 };
    group.total += 1;
    if (isFalsePositive(item)) group.negative += 1;
    groups.set(key, group);
  }
  for (const [key, group] of groups) {
    if (group.total < MIN_GROUP_SAMPLE) continue;
    const ratio = group.negative / group.total;
    if (ratio < DEGRADATION_RATIO) continue;
    const [targetType, riskLevel] = key.split(":");
    notes.set(`rule_degradation:${key}:${ruleVersion}`, {
      ...base,
      note_key: `rule_degradation:${key}:${ruleVersion}`,
      note_type: "rule_degradation",
      source_case_id: null,
      target_type: targetType,
      target_id: null,
      summary: `规则可能失效：${targetType}/${riskLevel} 近窗 ${group.total} 单，`
        + `否决或跳过 ${group.negative} 单（${Math.round(ratio * 100)}%）`,
      confidence: Math.round(ratio * 100),
      evidence_count: group.total,
    });
  }

  // 缺口：巡检建单后长期无人处置
  const stale = new Map<string, number>();
  for (const item of feedback) {
    if (!item.source.startsWith("agent")) continue;
    if (!isPending(item)) continue;
    if (ageDays(item.created_at, now) < STALE_PENDING_DAYS) continue;
    bump(stale, groupKey(item));
  }
  for (const [key, count] of stale) {
    const [targetType, riskLevel] = key.split(":");
    notes.set(`gap:pending:${key}:${ruleVersion}`, {
      ...base,
      note_key: `gap:pending:${key}:${ruleVersion}`,
      note_type: "gap",
      source_case_id: null,
      target_type: targetType,
      target_id: null,
      summary: `流程缺口：${targetType}/${riskLevel} 有 ${count} 单建单后超过 `
        + `${STALE_PENDING_DAYS} 天未处置，请人工确认`,
      confidence: 75,
      evidence_count: count,
    });
  }

  // 目标发现：高发但未被判为规则失效的内容类型，供下阶段关注
  for (const [key, group] of groups) {
    if (group.total < FOCUS_MIN_SAMPLE) continue;
    if (group.negative / group.total >= DEGRADATION_RATIO) continue;
    const [targetType, riskLevel] = key.split(":");
    notes.set(`focus:${key}:${ruleVersion}`, {
      ...base,
      note_key: `focus:${key}:${ruleVersion}`,
      note_type: "focus",
      source_case_id: null,
      target_type: targetType,
      target_id: null,
      summary: `关注点：${targetType}/${riskLevel} 近窗 ${group.total} 单，`
        + `建议下阶段重点复核`,
      confidence: 60,
      evidence_count: group.total,
    });
  }

  const sorted = [...notes.values()]
    .sort((left, right) => right.confidence - left.confidence
      || left.note_key.localeCompare(right.note_key));
  // 预算内先为缺口与目标发现各保留一席，避免被单条误报挤掉
  const selected: PatrolNoteInput[] = [];
  for (const type of ["gap", "focus"] as const) {
    const first = sorted.find(note => note.note_type === type);
    if (first) selected.push(first);
  }
  for (const note of sorted) {
    if (selected.length >= maxNotes) break;
    if (!selected.some(picked => picked.note_key === note.note_key)) selected.push(note);
  }
  return selected.slice(0, maxNotes);
};

const finishRun = async (
  client: UserInternalClient, runId: string, trace: TraceId,
  status: "succeeded" | "failed", summary: string,
): Promise<void> => {
  try {
    await client.audit.finishRun(runId, status === "succeeded"
      ? { status, output_summary: summary }
      : { status, error_summary: summary }, trace);
  } catch (error) {
    console.error(JSON.stringify({ event: "consolidation_finish_failed", agent_run_id: runId,
      reason: error instanceof Error ? error.name : "unknown" }));
  }
};

/** 执行一次离线整理：读反馈 → 生成笔记 → 幂等写入；失败写终态并向上抛出 */
export const runPatrolConsolidation = async (
  deps: ConsolidationDeps,
): Promise<ConsolidationOutcome> => {
  const client = deps.client;
  const trace = deps.traceId ?? asTraceId(randomUUID());
  const runId = randomUUID();
  const days = deps.days ?? DEFAULT_DAYS;
  await client.audit.createRun({
    agent_run_id: runId,
    task_type: CONSOLIDATION_TASK_TYPE,
    input_summary: `夜间离线整理：近 ${days} 天工单判定与处置`,
  }, trace);
  try {
    const { expired } = await client.expirePatrolNotes(trace);
    const feedback = await client.fetchPatrolFeedback(
      { days, limit: deps.limit ?? DEFAULT_LIMIT }, trace,
    );
    const notes = buildPatrolNotes(feedback);
    if (notes.length === 0) {
      await finishRun(client, runId, trace, "succeeded",
        `过期 ${expired} 条，读取 ${feedback.length} 单，样本不足或无需记录`);
      return { analyzed: feedback.length, notes: 0, repeated: 0, expired };
    }
    const ack = await client.createPatrolNotes({ notes }, trace, runId);
    await finishRun(client, runId, trace, "succeeded",
      `过期 ${expired} 条，读取 ${feedback.length} 单，写入 ${notes.length} 条笔记`);
    return { analyzed: feedback.length, notes: notes.length, repeated: ack.repeated, expired };
  } catch (error) {
    await finishRun(client, runId, trace, "failed", "离线整理失败");
    throw error;
  }
};
