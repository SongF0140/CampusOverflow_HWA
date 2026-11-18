// 管理员全量扫描执行器（P2）：按服务端游标分批推进，只建单不处置；取消或达上限即停。
import { randomUUID } from "node:crypto";
import type { LanguageModel } from "ai";

import { createLanguageModel } from "../config.js";
import type { PatrolScanTargetType, UserInternalClient } from "../internal-client.js";
import type { SecurityHooks } from "../security/contracts.js";
import { asTraceId } from "../types/index.js";
import { evaluatePatrolContent, loadInjectedContext } from "./moderation-patrol.js";

export const FULL_SCAN_TASK_TYPE = "moderation_full_scan";
const DEFAULT_BATCH_SIZE = 50;
const DEFAULT_MAX_ITEMS = 5000;

export type FullScanStatus = "succeeded" | "failed" | "cancelled";

export interface FullScanDeps {
  jobId: number;
  client: UserInternalClient;
  getModel?: () => LanguageModel;
  hooks?: SecurityHooks;
  batchSize?: number;
  maxItems?: number;
}

export interface FullScanOutcome {
  status: FullScanStatus;
  scanned: number;
  escalated: number;
  skipped: number;
  failed: number;
}

const bounded = (value: number, min: number, max: number, fallback: number): number =>
  Number.isInteger(value) && value >= min && value <= max ? value : fallback;

const finishRun = async (
  client: UserInternalClient, runId: string, trace: string,
  status: "succeeded" | "failed", summary: string,
): Promise<void> => {
  try {
    await client.audit.finishRun(runId, status === "succeeded"
      ? { status, output_summary: summary }
      : { status, error_summary: summary }, asTraceId(trace));
  } catch (error) {
    console.error(JSON.stringify({
      event: "full_scan_finish_failed", agent_run_id: runId,
      reason: error instanceof Error ? error.name : "unknown",
    }));
  }
};

const markJobFailed = async (
  client: UserInternalClient, jobId: number, trace: string, summary: string,
): Promise<void> => {
  try {
    await client.updatePatrolScanProgress(
      jobId, { status: "failed", errorSummary: summary }, asTraceId(trace),
    );
  } catch (error) {
    console.error(JSON.stringify({
      event: "full_scan_progress_failed", job_id: jobId,
      reason: error instanceof Error ? error.name : "unknown",
    }));
  }
};

/** 执行一个扫描任务；返回最终状态与累计计数。 */
export const runFullScanJob = async (deps: FullScanDeps): Promise<FullScanOutcome> => {
  const client = deps.client;
  const trace = randomUUID();
  const batchSize = bounded(deps.batchSize ?? DEFAULT_BATCH_SIZE, 1, 100, DEFAULT_BATCH_SIZE);
  const maxItems = bounded(deps.maxItems ?? DEFAULT_MAX_ITEMS, 1, 20000, DEFAULT_MAX_ITEMS);
  const outcome: FullScanOutcome = {
    status: "failed", scanned: 0, escalated: 0, skipped: 0, failed: 0,
  };

  let model: LanguageModel;
  try {
    model = deps.getModel?.() ?? createLanguageModel();
  } catch {
    await markJobFailed(client, deps.jobId, trace, "模型未配置，扫描未执行");
    return outcome;
  }

  const runId = randomUUID();
  try {
    await client.audit.createRun({
      agent_run_id: runId, task_type: FULL_SCAN_TASK_TYPE,
      input_summary: `管理员全量扫描 #${deps.jobId}`,
    }, asTraceId(trace));
  } catch {
    // 审计不可用时阻断扫描，避免无留痕运行（与 G-04-B 一致）
    await markJobFailed(client, deps.jobId, trace, "审计服务不可用，扫描未执行");
    return outcome;
  }

  let cancelled = false;
  try {
    const systemSuffix = await loadInjectedContext(client, trace);
    while (true) {
      const page = await client.fetchPatrolScanPage(
        { jobId: deps.jobId, limit: batchSize }, asTraceId(trace),
      );
      if (page.job.status === "cancelled") {
        cancelled = true;
        break;
      }
      if (page.job.status === "failed" || page.job.status === "succeeded") {
        outcome.status = page.job.status;
        break;
      }
      if (page.items.length === 0) {
        const updated = await client.updatePatrolScanProgress(
          deps.jobId, { status: "succeeded" }, asTraceId(trace),
        );
        outcome.status = updated.status === "cancelled" ? "cancelled"
          : updated.status === "failed" ? "failed" : "succeeded";
        break;
      }

      let batchScanned = 0;
      let batchEscalated = 0;
      let batchSkipped = 0;
      let batchFailed = 0;
      let cursorType: PatrolScanTargetType | null = null;
      let cursorId: number | null = null;
      for (const content of page.items) {
        if (outcome.scanned + batchScanned >= maxItems) break;
        // 每条前核对取消标记，保证取消能在一批内生效
        const current = await client.getPatrolScan(deps.jobId, asTraceId(trace));
        if (current.status === "cancelled") {
          cancelled = true;
          break;
        }
        const result = await evaluatePatrolContent(
          client, model, content, runId, deps.hooks, systemSuffix,
        );
        if (result === "escalated") {
          batchEscalated += 1;
          outcome.escalated += 1;
        } else if (result === "failed") {
          batchFailed += 1;
          outcome.failed += 1;
        } else {
          batchSkipped += 1;
          outcome.skipped += 1;
        }
        cursorType = content.target_type;
        cursorId = content.target_id;
        batchScanned += 1;
        outcome.scanned += 1;
      }
      if (cancelled) break;

      const reachedMax = outcome.scanned >= maxItems;
      const nextStatus = reachedMax && page.has_more
        ? "failed" : page.has_more ? "running" : "succeeded";
      const updated = await client.updatePatrolScanProgress(deps.jobId, {
        cursorType, cursorId, scannedDelta: batchScanned,
        escalatedDelta: batchEscalated, skippedDelta: batchSkipped,
        failedDelta: batchFailed, status: nextStatus,
        errorSummary: nextStatus === "failed"
          ? `达到单次扫描上限 ${maxItems} 条，剩余内容未处理` : null,
      }, asTraceId(trace));
      if (updated.status === "cancelled") {
        cancelled = true;
        break;
      }
      if (nextStatus === "failed") {
        outcome.status = "failed";
        break;
      }
      if (!page.has_more) {
        outcome.status = "succeeded";
        break;
      }
    }
  } catch (error) {
    await markJobFailed(client, deps.jobId, trace, "扫描执行异常，已停止");
    outcome.status = "failed";
    await finishRun(client, runId, trace, "failed",
      `全量扫描异常：${error instanceof Error ? error.name : "unknown"}`);
    return outcome;
  }

  outcome.status = cancelled ? "cancelled" : outcome.status;
  const summary = `扫描 ${outcome.scanned} 条，升级 ${outcome.escalated} 条，失败 ${outcome.failed} 条`;
  await finishRun(client, runId, trace,
    outcome.status === "succeeded" ? "succeeded" : "failed",
    cancelled ? "管理员取消扫描" : summary);
  return outcome;
};
