// 快照切换指标：仅内存保存最近一次构建/切换摘要，不含正文、路径、凭证与错误堆栈。
export type SnapshotKind = "knowledge" | "qa";
export type SnapshotAction = "build" | "promote" | "rollback";

export interface SnapshotEvent {
  kind: SnapshotKind;
  at: string;
  action: SnapshotAction;
  version: string | null;
  items: number | null;
  errors: number;
  ok: boolean;
  reason: string | null;
}

const MAX_REASON = 200;
const latest: Record<SnapshotKind, Omit<SnapshotEvent, "kind"> | null> = {
  knowledge: null,
  qa: null,
};

const sanitize = (reason: string | null | undefined): string | null =>
  reason ? reason.replace(/[\r\n\t]+/gu, " ").trim().slice(0, MAX_REASON) || null : null;

export const recordSnapshotEvent = (
  kind: SnapshotKind,
  event: Omit<SnapshotEvent, "kind" | "at" | "reason"> & {
    at?: string;
    reason?: string | null;
  },
): void => {
  latest[kind] = {
    at: event.at ?? new Date().toISOString(),
    action: event.action,
    version: event.version,
    items: event.items,
    errors: event.errors,
    ok: event.ok,
    reason: sanitize(event.reason),
  };
};

export const readSnapshotMetrics = (): Record<SnapshotKind, SnapshotEvent | null> => ({
  knowledge: latest.knowledge ? { kind: "knowledge", ...latest.knowledge } : null,
  qa: latest.qa ? { kind: "qa", ...latest.qa } : null,
});

/** 仅用于测试隔离；生产不重置，指标随进程存活 */
export const resetSnapshotMetrics = (): void => {
  latest.knowledge = null;
  latest.qa = null;
};
