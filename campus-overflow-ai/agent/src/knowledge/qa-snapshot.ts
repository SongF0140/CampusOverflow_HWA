// 问答索引不可变快照：按游标导出、版本哈希、双槽挂载；只读，不含正文与作者。
import { createHash } from "node:crypto";

import type { QaIndexItem, UserInternalClient } from "../internal-client.js";
import type { TraceId } from "../types/index.js";

export interface QaSnapshot {
  version: string;
  items: readonly QaIndexItem[];
  byId: ReadonlyMap<number, QaIndexItem>;
}

export interface BuildQaSnapshotOptions {
  pageSize?: number;
  maxItems?: number;
}

const clamp = (value: number, min: number, max: number, fallback: number): number =>
  Number.isInteger(value) && value >= min && value <= max ? value : fallback;

const versionOf = (items: readonly QaIndexItem[]): string => createHash("sha256")
  .update(JSON.stringify(items.map(item => [
    item.id, item.title, item.course_id, item.status, item.tag_ids, item.updated_at,
  ])))
  .digest("hex")
  .slice(0, 16);

export const buildQaSnapshot = async (
  client: UserInternalClient, traceId: TraceId, options: BuildQaSnapshotOptions = {},
): Promise<QaSnapshot> => {
  const pageSize = clamp(options.pageSize ?? 200, 1, 500, 200);
  const maxItems = clamp(options.maxItems ?? 5000, 1, 20000, 5000);
  const items: QaIndexItem[] = [];
  let cursor = 0;
  while (items.length < maxItems) {
    const page = await client.fetchQaIndexSnapshot({ cursor, limit: pageSize }, traceId);
    items.push(...page.items);
    if (page.next_cursor === null) break;
    if (page.next_cursor <= cursor) throw new Error("qa_snapshot_cursor_stalled");
    cursor = page.next_cursor;
  }
  const trimmed = items.slice(0, maxItems);
  return {
    version: versionOf(trimmed),
    items: trimmed,
    byId: new Map(trimmed.map(item => [item.id, item])),
  };
};

interface SlotSnapshot {
  snapshot: QaSnapshot;
  expiresAt?: number;
}

export interface QaSlotInfo {
  active: { version: string; items: number } | null;
  staging: { version: string; items: number } | null;
  previous: { version: string; items: number; expires_at: string } | null;
}

/** 同进程双槽：与知识目录同构，旧槽默认保留 24 小时 */
export const createQaSnapshotSlots = (
  ttlMs = 24 * 60 * 60 * 1000, now: () => number = Date.now,
) => {
  let active: QaSnapshot | undefined;
  let staging: QaSnapshot | undefined;
  let previous: SlotSnapshot | undefined;
  // 任意槽访问时清理过期旧槽，避免长期占用内存；回退仍按 expiresAt 给出明确错误
  const expirePrevious = (): void => {
    if (!previous || now() <= (previous.expiresAt ?? 0)) return;
    console.log(JSON.stringify({
      event: "qa_snapshot_previous_expired", version: previous.snapshot.version,
    }));
    previous = undefined;
  };
  const slotInfo = (): QaSlotInfo => ({
    active: active ? { version: active.version, items: active.items.length } : null,
    staging: staging ? { version: staging.version, items: staging.items.length } : null,
    previous: previous ? {
      version: previous.snapshot.version,
      items: previous.snapshot.items.length,
      expires_at: new Date(previous.expiresAt ?? 0).toISOString(),
    } : null,
  });
  const info = (): QaSlotInfo => {
    expirePrevious();
    return slotInfo();
  };
  const stage = (snapshot: QaSnapshot): QaSlotInfo => {
    staging = snapshot;
    return slotInfo();
  };
  const promote = (): QaSlotInfo => {
    if (!staging) throw new Error("没有待切换的问答快照");
    if (active) previous = { snapshot: active, expiresAt: now() + ttlMs };
    active = staging;
    staging = undefined;
    return slotInfo();
  };
  const rollback = (): QaSlotInfo => {
    if (!previous) throw new Error("没有可回退的问答快照");
    if (now() > (previous.expiresAt ?? 0)) {
      expirePrevious();
      throw new Error("问答旧快照已过期");
    }
    active = previous.snapshot;
    previous = undefined;
    staging = undefined;
    return slotInfo();
  };
  return { stage, promote, rollback, info, getActive: () => active };
};

export const qaSnapshotSlots = createQaSnapshotSlots();

export interface SearchQaSnapshotOptions {
  courseId?: number;
  limit?: number;
}

// 关键词切分：空白、中英文标点与常见括号；仅用于扩大标题命中，不做语义分词
const TOKEN_SPLIT = /[\s,，。；;：:、!！?？()（）[\]【】"'“”‘’]+/u;
// 长关键词按 2-gram 兜底，最多取 32 个，避免长问句放大扫描成本
const MAX_GRAMS = 32;

const tokensOf = (keyword: string): string[] => [
  ...new Set(keyword.split(TOKEN_SPLIT).filter(token => token.length > 0)),
];

const bigramsOf = (keyword: string): string[] => {
  const compact = keyword.replace(/[\s\p{P}]+/gu, "");
  const grams: string[] = [];
  for (let index = 0; index < compact.length - 1; index += 1) {
    grams.push(compact.slice(index, index + 2));
  }
  return [...new Set(grams)].slice(0, MAX_GRAMS);
};

/** 快照只负责出候选 id：按标题相关度排序，最终可见性仍由后端复核 */
export const searchQaSnapshot = (
  snapshot: QaSnapshot, keyword: string, options: SearchQaSnapshotOptions = {},
): number[] => {
  const normalized = keyword.trim().toLowerCase();
  if (!normalized) return [];
  const limit = clamp(options.limit ?? 50, 1, 50, 50);
  const tokens = tokensOf(normalized);
  const bigrams = normalized.length > 1 ? bigramsOf(normalized) : [];
  const scored: Array<{ id: number; score: number }> = [];
  for (const item of snapshot.items) {
    if (options.courseId !== undefined && item.course_id !== options.courseId) continue;
    const title = item.title.toLowerCase();
    if (!title) continue;
    let score = title.includes(normalized) ? 100 : 0;
    if (title === normalized) score += 50;
    for (const token of tokens) {
      if (token !== normalized && title.includes(token)) score += 10;
    }
    for (const gram of bigrams) {
      if (title.includes(gram)) score += 1;
    }
    if (score > 0) scored.push({ id: item.id, score });
  }
  scored.sort((left, right) => right.score - left.score || right.id - left.id);
  return scored.slice(0, limit).map(entry => entry.id);
};
