// 夜间离线整理定时器：每日固定时刻触发一次，默认关闭。
// 进程内单定时器 + 运行互斥；失败只记录日志，次日继续（不立即重试）。
import type { UserInternalClient } from "../internal-client.js";
import type { KnowledgeCatalog } from "../knowledge/catalog.js";
import { recordSnapshotEvent } from "../knowledge/snapshot-metrics.js";
import { runPatrolConsolidation } from "./nightly-consolidation.js";
import { runNightlySnapshot } from "./nightly-snapshot.js";

export interface NightlyConfig {
  enabled: boolean;
  hour: number;
  minute: number;
  days: number;
  snapshotEnabled: boolean;
  qaSnapshotEnabled: boolean;
}

const bounded = (value: number, min: number, max: number, fallback: number): number =>
  Number.isInteger(value) && value >= min && value <= max ? value : fallback;

export const loadNightlyConfig = (env: NodeJS.ProcessEnv = process.env): NightlyConfig => ({
  enabled: (env.NIGHTLY_CONSOLIDATION_ENABLED ?? "false") === "true",
  hour: bounded(Number(env.NIGHTLY_CONSOLIDATION_HOUR ?? 1), 0, 23, 1),
  minute: bounded(Number(env.NIGHTLY_CONSOLIDATION_MINUTE ?? 0), 0, 59, 0),
  days: bounded(Number(env.NIGHTLY_CONSOLIDATION_DAYS ?? 14), 1, 90, 14),
  snapshotEnabled: (env.NIGHTLY_SNAPSHOT_ENABLED ?? "false") === "true",
  qaSnapshotEnabled: (env.NIGHTLY_QA_SNAPSHOT_ENABLED ?? "false") === "true",
});

/** 下一次触发时刻：当天时刻未过则当天，否则次日（本地时区） */
export const nextNightlyOccurrence = (config: NightlyConfig, from: Date): Date => {
  const next = new Date(from);
  next.setHours(config.hour, config.minute, 0, 0);
  if (next.getTime() <= from.getTime()) next.setDate(next.getDate() + 1);
  return next;
};

export interface NightlyDeps {
  createClient: () => UserInternalClient;
  getCatalog?: () => KnowledgeCatalog | undefined;
  syncQaSnapshot?: () => Promise<{ version: string; items: number }>;
  config?: NightlyConfig;
  now?: () => Date;
}

export const startNightlyConsolidationScheduler = (deps: NightlyDeps): (() => void) => {
  const config = deps.config ?? loadNightlyConfig();
  if (!config.enabled) return () => {};

  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  let running = false;

  const schedule = (): void => {
    if (stopped) return;
    const now = deps.now?.() ?? new Date();
    const delay = Math.max(0, nextNightlyOccurrence(config, now).getTime() - now.getTime());
    timer = setTimeout(() => { void run(); }, delay);
    (timer as NodeJS.Timeout).unref?.();
  };

  const run = async (): Promise<void> => {
    if (stopped) return;
    const at = () => (deps.now?.() ?? new Date()).toISOString();
    if (running) {
      console.error(JSON.stringify({
        event: "nightly_consolidation_skipped", reason: "already_running",
      }));
    } else {
      running = true;
      try {
        if (config.snapshotEnabled) {
          try {
            const catalog = deps.getCatalog?.();
            if (catalog) {
              const snapshot = await runNightlySnapshot(catalog);
              recordSnapshotEvent("knowledge", {
                action: snapshot.promoted ? "promote" : "build",
                version: snapshot.version,
                items: catalog.slots().active.cards,
                errors: snapshot.errors,
                ok: true,
                at: at(),
              });
              console.log(JSON.stringify({ event: "nightly_snapshot_done", ...snapshot }));
            }
          } catch (error) {
            // 快照失败不阻塞离线整理；旧槽继续服务
            const reason = error instanceof Error ? error.message : "unknown";
            recordSnapshotEvent("knowledge", {
              action: "build", version: null, items: null, errors: 1, ok: false, reason, at: at(),
            });
            console.error(JSON.stringify({
              event: "nightly_snapshot_failed",
              reason,
            }));
          }
        }
        if (config.qaSnapshotEnabled && deps.syncQaSnapshot) {
          try {
            const snapshot = await deps.syncQaSnapshot();
            recordSnapshotEvent("qa", {
              action: "promote",
              version: snapshot.version,
              items: snapshot.items,
              errors: 0,
              ok: true,
              at: at(),
            });
            console.log(JSON.stringify({
              event: "nightly_qa_snapshot_done", ...snapshot,
            }));
          } catch (error) {
            const reason = error instanceof Error ? error.message : "unknown";
            recordSnapshotEvent("qa", {
              action: "build", version: null, items: null, errors: 1, ok: false, reason, at: at(),
            });
            console.error(JSON.stringify({
              event: "nightly_qa_snapshot_failed",
              reason,
            }));
          }
        }
        const outcome = await runPatrolConsolidation({
          client: deps.createClient(), days: config.days,
        });
        console.log(JSON.stringify({ event: "nightly_consolidation_done", ...outcome }));
      } catch (error) {
        console.error(JSON.stringify({
          event: "nightly_consolidation_failed",
          reason: error instanceof Error ? error.name : "unknown",
        }));
      } finally {
        running = false;
      }
    }
    schedule();
  };

  schedule();
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
};
