import { watch, type FSWatcher } from "node:fs";
import { realpath } from "node:fs/promises";

import { cardFiles, hash, safeRead } from "./files.js";
import { bodySection, parseCard, validateTags } from "./markdown.js";
import type { CatalogUpdate, StoredCard, TrustedKnowledgeTag } from "./types.js";

export interface CatalogOptions {
  root: string;
  trustedTags: () => readonly TrustedKnowledgeTag[] | Promise<readonly TrustedKnowledgeTag[]>;
  onUpdate?: (version: string) => void;
  onError?: () => void;
  /** 旧快照保留时长，默认 24 小时；可回退窗口 */
  previousTtlMs?: number;
}

interface StagedSnapshot {
  snapshot: Map<string, StoredCard>;
  version: string;
  root: string;
}

interface PreviousSnapshot extends StagedSnapshot {
  expiresAt: number;
}

export interface SlotInfo {
  active: { version: string; cards: number };
  staging: { version: string; cards: number } | null;
  previous: { version: string; cards: number; expires_at: string } | null;
}

const versionOf = (cards: readonly StoredCard[]): string => hash(JSON.stringify(
  cards.map(item => [item.card.id, item.cardHash, item.bodyHash]).sort((a, b) => a[0].localeCompare(b[0])),
));

const scanSources = async (options: CatalogOptions, previous: Map<string, StoredCard>) => {
  const next = new Map<string, StoredCard>();
  let root = "";
  const result: CatalogUpdate = { version: "", added: [], updated: [], removed: [], parsed: 0, errors: [] };
  try {
    root = await realpath(options.root);
    const tags = await options.trustedTags();
    for (const id of await cardFiles(root)) {
      try {
        const raw = await safeRead(root, id, 64_000);
        const cardHash = hash(raw);
        const old = previous.get(id);
        const card = old?.cardHash === cardHash ? old.card : parseCard(id, raw);
        if (old?.cardHash !== cardHash) result.parsed++;
        validateTags(card, tags);
        const body = await safeRead(root, card.metadata.body.path, 2_000_000);
        bodySection(root, card, body);
        next.set(id, { card, cardHash, bodyHash: hash(body) });
      } catch { result.errors.push({ id, code: "invalid_source" }); }
    }
  } catch { result.errors.push({ id: "cards/", code: "invalid_source" }); }
  for (const [id, item] of next) {
    const old = previous.get(id);
    if (!old) result.added.push(id);
    else if (old.cardHash !== item.cardHash || old.bodyHash !== item.bodyHash) result.updated.push(id);
  }
  result.removed = [...previous.keys()].filter(id => !next.has(id));
  result.version = versionOf([...next.values()]);
  return { next, root, result };
};

export const createKnowledgeCatalog = (options: CatalogOptions) => {
  let snapshot = new Map<string, StoredCard>();
  let version = versionOf([]);
  let canonicalRoot = "";
  let pending: Promise<CatalogUpdate> | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;
  let watcher: FSWatcher | undefined;
  let staging: StagedSnapshot | undefined;
  let previous: PreviousSnapshot | undefined;
  const previousTtlMs = options.previousTtlMs ?? 24 * 60 * 60 * 1000;
  const failure = () => options.onError?.();
  const accessible = (courses: readonly number[]) => [...snapshot.values()].filter(item =>
    courses.includes(item.card.metadata.course_id));

  const scan = async (): Promise<CatalogUpdate> => {
    const { next, root, result } = await scanSources(options, snapshot);
    const changed = result.version !== version;
    snapshot = next;
    canonicalRoot = root;
    version = result.version;
    if (changed) {
      try { options.onUpdate?.(version); } catch { failure(); }
    }
    return result;
  };

  const refresh = (): Promise<CatalogUpdate> => {
    if (pending) return pending;
    pending = scan().finally(() => { pending = undefined; });
    return pending;
  };
  const list = (courses: readonly number[]) => {
    const cards = accessible(courses);
    return { version: versionOf(cards), cards: cards.map(({ card }) => ({
      id: card.id, domain: card.domain, course_id: card.metadata.course_id, tag_ids: [...card.metadata.tag_ids],
    })) };
  };
  const getCard = (id: string, courses: readonly number[]) => {
    const item = snapshot.get(id);
    return item && courses.includes(item.card.metadata.course_id) ? structuredClone(item.card) : undefined;
  };
  const getBody = async (id: string, courses: readonly number[], expectedVersion: string) => {
    const item = snapshot.get(id);
    if (!item || !courses.includes(item.card.metadata.course_id)) return undefined;
    if (expectedVersion !== list(courses).version) throw new Error("目录版本已变化，请重新检索");
    try {
      validateTags(item.card, await options.trustedTags());
      const raw = await safeRead(canonicalRoot, id, 64_000);
      const body = await safeRead(canonicalRoot, item.card.metadata.body.path, 2_000_000);
      if (hash(raw) !== item.cardHash || hash(body) !== item.bodyHash) throw new Error("changed");
      return { card_id: id, bookmark: item.card.metadata.body.bookmark,
        content: bodySection(canonicalRoot, item.card, body), version: expectedVersion };
    } catch { throw new Error("资料版本已变化，请重新检索"); }
  };
  const stop = () => {
    if (timer) clearInterval(timer);
    watcher?.close();
    timer = undefined;
    watcher = undefined;
  };
  /** 只构建候选快照，不切换活跃槽；用于夜间冻结窗口 */
  const stage = async (): Promise<CatalogUpdate> => {
    const { next, root, result } = await scanSources(options, snapshot);
    staging = { snapshot: next, version: result.version, root };
    return result;
  };
  const slotInfo = (): SlotInfo => ({
    active: { version, cards: snapshot.size },
    staging: staging ? { version: staging.version, cards: staging.snapshot.size } : null,
    previous: previous ? {
      version: previous.version, cards: previous.snapshot.size,
      expires_at: new Date(previous.expiresAt).toISOString(),
    } : null,
  });
  const slots = (): SlotInfo => {
    expirePrevious();
    return slotInfo();
  };
  /** 任意槽访问时清理过期旧槽，避免长期占用内存 */
  const expirePrevious = (): void => {
    if (!previous || Date.now() <= previous.expiresAt) return;
    console.log(JSON.stringify({
      event: "knowledge_snapshot_previous_expired", version: previous.version,
    }));
    previous = undefined;
  };
  /** 校验通过后切换；旧槽保留 previousTtlMs 供回退 */
  const promote = (): SlotInfo => {
    if (!staging) throw new Error("没有待切换的快照");
    previous = { snapshot, version, root: canonicalRoot, expiresAt: Date.now() + previousTtlMs };
    snapshot = staging.snapshot;
    version = staging.version;
    canonicalRoot = staging.root;
    staging = undefined;
    try { options.onUpdate?.(version); } catch { failure(); }
    return slotInfo();
  };
  const rollback = (): SlotInfo => {
    if (!previous) throw new Error("没有可回退的旧快照");
    if (Date.now() > previous.expiresAt) {
      expirePrevious();
      throw new Error("旧快照已过期");
    }
    snapshot = previous.snapshot;
    version = previous.version;
    canonicalRoot = previous.root;
    previous = undefined;
    staging = undefined;
    return slotInfo();
  };
  const start = async (intervalMs = 60_000): Promise<void> => {
    if (!Number.isFinite(intervalMs) || intervalMs < 1000) throw new Error("核对间隔至少 1000 毫秒");
    stop();
    await refresh();
    const update = () => { void refresh().catch(failure); };
    // 文件变化仅提示刷新；定期完整扫描负责弥补丢失/合并事件。
    try { watcher = watch(options.root, { recursive: true }, update); watcher.on("error", failure); watcher.unref(); }
    catch { failure(); }
    timer = setInterval(update, intervalMs);
    timer.unref();
  };
  return { refresh, list, getCard, getBody, start, stop, stage, promote, rollback, slots };
};

export type KnowledgeCatalog = ReturnType<typeof createKnowledgeCatalog>;
