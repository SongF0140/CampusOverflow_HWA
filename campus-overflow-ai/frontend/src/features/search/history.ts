// 搜索历史（localStorage，key=co_search_history）：纯函数，storage 由调用方注入便于测试
// 规格（§2.17）：最近 10 条，新搜索置顶去重，逐条可删、一键清空
export const SEARCH_HISTORY_KEY = "co_search_history";
export const SEARCH_HISTORY_LIMIT = 10;

type HistoryStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

// 读取并净化历史：坏 JSON / 非数组 / 非字符串项一律丢弃，去重后截断上限
export function loadSearchHistory(storage: HistoryStorage): string[] {
  const raw = storage.getItem(SEARCH_HISTORY_KEY);
  if (raw === null) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const keywords: string[] = [];
  for (const item of parsed) {
    if (typeof item !== "string") continue;
    const value = item.trim();
    if (!value || keywords.includes(value)) continue;
    keywords.push(value);
  }
  return keywords.slice(0, SEARCH_HISTORY_LIMIT);
}

function writeHistory(storage: HistoryStorage, keywords: string[]): void {
  // 空历史直接移除 key，避免 localStorage 里残留 "[]"
  if (keywords.length === 0) {
    storage.removeItem(SEARCH_HISTORY_KEY);
    return;
  }
  storage.setItem(SEARCH_HISTORY_KEY, JSON.stringify(keywords));
}

// 新搜索置顶去重；空白关键词不写入（返回当前历史不变）
export function saveSearchKeyword(storage: HistoryStorage, keyword: string): string[] {
  const value = keyword.trim();
  if (!value) return loadSearchHistory(storage);
  const next = [value, ...loadSearchHistory(storage).filter((item) => item !== value)];
  const capped = next.slice(0, SEARCH_HISTORY_LIMIT);
  writeHistory(storage, capped);
  return capped;
}

export function removeSearchKeyword(storage: HistoryStorage, keyword: string): string[] {
  const next = loadSearchHistory(storage).filter((item) => item !== keyword);
  writeHistory(storage, next);
  return next;
}

export function clearSearchHistory(storage: HistoryStorage): string[] {
  storage.removeItem(SEARCH_HISTORY_KEY);
  return [];
}
