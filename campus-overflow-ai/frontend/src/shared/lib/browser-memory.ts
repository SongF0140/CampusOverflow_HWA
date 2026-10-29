// 浏览器个人记忆（T-14，AG-R04 / Q-10 定案）：localStorage 按账号命名空间隔离，
// 用户手动维护（新增/删除/清空），AI 只读（buildMemoryContext 注入助手）。
// 敏感信息写入拦截（X-06）：命中密钥/口令类关键词即拒绝，拦截原因不含原文；
// 浏览器内容不构成后端授权，不云同步、不提供他人读取。

export const MEMORY_KEY_PREFIX = "co_memory_user_";
export const MEMORY_MAX_ENTRIES = 50;
export const MEMORY_CONTENT_MAX_LEN = 500;
/** 注入 AI 请求的上下文条数上限（与 Agent 聊天契约 browser_memory ≤20 对齐） */
export const MEMORY_CONTEXT_LIMIT = 20;

export interface MemoryEntry {
  id: string;
  content: string;
  created_at: string;
}

/** 敏感关键词（与 backend governance/domain.SENSITIVE_KEYWORDS 同源语义；小写匹配） */
const SENSITIVE_KEYWORDS = [
  "password", "passwd", "pwd", "token", "secret", "api_key", "apikey",
  "access_key", "cookie", "authorization", "credential", "private_key",
  "密码", "口令", "密钥", "凭证",
] as const;

export type MemoryWriteResult =
  | { ok: true; entries: MemoryEntry[] }
  | { ok: false; reason: string };

const namespaceKey = (userId: number): string => `${MEMORY_KEY_PREFIX}${userId}`;
export const MEMORY_CHANGED_EVENT = "co-memory-changed";
const announceMemoryChange = (userId: number) => {
  window.dispatchEvent(new CustomEvent(MEMORY_CHANGED_EVENT, { detail: { userId } }));
};

/** 敏感判定：内容（小写化后）命中任一关键词即拒绝；错误文案不含原文 */
export const isSensitiveContent = (content: string): boolean => {
  const lowered = content.toLowerCase();
  return SENSITIVE_KEYWORDS.some((keyword) => lowered.includes(keyword));
};

const readEntries = (userId: number): MemoryEntry[] => {
  if (typeof window === "undefined") return []; // SSR 安全
  const raw = window.localStorage.getItem(namespaceKey(userId));
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is MemoryEntry =>
        typeof item === "object" && item !== null
          && typeof (item as MemoryEntry).id === "string"
          && typeof (item as MemoryEntry).content === "string"
          && typeof (item as MemoryEntry).created_at === "string",
    );
  } catch {
    return []; // 损坏数据按空处理（X-04：回退默认状态）
  }
};

const writeEntries = (userId: number, entries: MemoryEntry[]): void => {
  window.localStorage.setItem(namespaceKey(userId), JSON.stringify(entries));
  announceMemoryChange(userId);
};

/** 列出该账号全部记忆（created_at 倒序最新在前；同毫秒按插入序平局裁决） */
export const listMemoryEntries = (userId: number): MemoryEntry[] =>
  readEntries(userId)
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) =>
      b.entry.created_at.localeCompare(a.entry.created_at) || b.index - a.index)
    .map(({ entry }) => entry);

/** 新增记忆：空白/超长/敏感/重复/超上限拒绝；返回写入后全量或拒绝原因 */
export const addMemoryEntry = (userId: number, content: string): MemoryWriteResult => {
  const trimmed = content.trim();
  if (!trimmed) return { ok: false, reason: "记忆内容不能为空" };
  if (trimmed.length > MEMORY_CONTENT_MAX_LEN) {
    return { ok: false, reason: `单条记忆不超过 ${MEMORY_CONTENT_MAX_LEN} 字` };
  }
  if (isSensitiveContent(trimmed)) {
    return { ok: false, reason: "记忆内容包含密码、密钥等敏感信息，已拒绝保存" };
  }
  const entries = readEntries(userId);
  if (entries.some((entry) => entry.content === trimmed)) {
    return { ok: false, reason: "该记忆已存在" };
  }
  if (entries.length >= MEMORY_MAX_ENTRIES) {
    return { ok: false, reason: `最多保存 ${MEMORY_MAX_ENTRIES} 条记忆，请先删除部分条目` };
  }
  const entry: MemoryEntry = {
    id: crypto.randomUUID(),
    content: trimmed,
    created_at: new Date().toISOString(),
  };
  const next = [...entries, entry];
  writeEntries(userId, next);
  return { ok: true, entries: listMemoryEntries(userId) };
};

/** 删除单条；返回删除后全量 */
export const removeMemoryEntry = (userId: number, entryId: string): MemoryEntry[] => {
  const next = readEntries(userId).filter((entry) => entry.id !== entryId);
  writeEntries(userId, next);
  return listMemoryEntries(userId);
};

/** 清空该账号全部记忆：删除命名空间键，此后不参与任何请求（E-11/AG-R04） */
export const clearMemoryEntries = (userId: number): void => {
  window.localStorage.removeItem(namespaceKey(userId));
  announceMemoryChange(userId);
};

/** AI 请求上下文注入助手：最新 20 条内容（与 Agent browser_memory ≤20 契约对齐）。
 * 清空后返回空数组，不再参与请求与建议。 */
export const buildMemoryContext = (userId: number): string[] =>
  listMemoryEntries(userId).slice(0, MEMORY_CONTEXT_LIMIT).map((entry) => entry.content);
