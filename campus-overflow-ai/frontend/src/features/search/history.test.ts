import { describe, expect, it } from "vitest";

import {
  SEARCH_HISTORY_KEY,
  SEARCH_HISTORY_LIMIT,
  clearSearchHistory,
  loadSearchHistory,
  removeSearchKeyword,
  saveSearchKeyword,
} from "./history";

// Map 版内存 Storage：不依赖 jsdom localStorage，写入/删除行为可精确断言
function createMemoryStorage(initial?: Record<string, string>) {
  const map = new Map<string, string>(Object.entries(initial ?? {}));
  return {
    getItem: (key: string) => (map.has(key) ? (map.get(key) as string) : null),
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
    removeItem: (key: string) => {
      map.delete(key);
    },
  };
}

describe("搜索历史纯函数", () => {
  it("存储 key 与上限符合规格（co_search_history / 10 条）", () => {
    expect(SEARCH_HISTORY_KEY).toBe("co_search_history");
    expect(SEARCH_HISTORY_LIMIT).toBe(10);
  });

  it("loadSearchHistory：无记录 / 坏 JSON / 非数组均返回空数组", () => {
    expect(loadSearchHistory(createMemoryStorage())).toEqual([]);
    expect(loadSearchHistory(createMemoryStorage({ [SEARCH_HISTORY_KEY]: "{oops" }))).toEqual([]);
    expect(loadSearchHistory(createMemoryStorage({ [SEARCH_HISTORY_KEY]: '"链表"' }))).toEqual([]);
  });

  it("loadSearchHistory：过滤非字符串与空白项并去重", () => {
    const storage = createMemoryStorage({
      [SEARCH_HISTORY_KEY]: JSON.stringify(["动态规划", "  ", 42, "动态规划", "链表"]),
    });
    expect(loadSearchHistory(storage)).toEqual(["动态规划", "链表"]);
  });

  it("loadSearchHistory：超过上限截断为最近 10 条", () => {
    const keywords = Array.from({ length: 13 }, (_, i) => `关键词${i}`);
    const storage = createMemoryStorage({ [SEARCH_HISTORY_KEY]: JSON.stringify(keywords) });
    expect(loadSearchHistory(storage)).toEqual(keywords.slice(0, 10));
  });

  it("saveSearchKeyword：新词置顶写入", () => {
    const storage = createMemoryStorage();
    expect(saveSearchKeyword(storage, "快速排序")).toEqual(["快速排序"]);
    expect(saveSearchKeyword(storage, "红黑树")).toEqual(["红黑树", "快速排序"]);
    expect(storage.getItem(SEARCH_HISTORY_KEY)).toBe(JSON.stringify(["红黑树", "快速排序"]));
  });

  it("saveSearchKeyword：重复词去重并置顶", () => {
    const storage = createMemoryStorage({
      [SEARCH_HISTORY_KEY]: JSON.stringify(["链表", "动态规划"]),
    });
    expect(saveSearchKeyword(storage, "链表")).toEqual(["链表", "动态规划"]);
  });

  it("saveSearchKeyword：空白关键词不写入且不破坏原历史", () => {
    const storage = createMemoryStorage({
      [SEARCH_HISTORY_KEY]: JSON.stringify(["链表"]),
    });
    expect(saveSearchKeyword(storage, "   ")).toEqual(["链表"]);
    expect(JSON.parse(storage.getItem(SEARCH_HISTORY_KEY) as string)).toEqual(["链表"]);
  });

  it("saveSearchKeyword：超过 10 条淘汰最旧记录", () => {
    const storage = createMemoryStorage();
    for (let i = 0; i < 12; i += 1) {
      saveSearchKeyword(storage, `关键词${i}`);
    }
    const keywords = loadSearchHistory(storage);
    expect(keywords).toHaveLength(10);
    expect(keywords[0]).toBe("关键词11");
    expect(keywords[9]).toBe("关键词2");
  });

  it("removeSearchKeyword：逐条删除，删空后移除存储 key", () => {
    const storage = createMemoryStorage({
      [SEARCH_HISTORY_KEY]: JSON.stringify(["链表", "动态规划"]),
    });
    expect(removeSearchKeyword(storage, "动态规划")).toEqual(["链表"]);
    expect(removeSearchKeyword(storage, "链表")).toEqual([]);
    expect(storage.getItem(SEARCH_HISTORY_KEY)).toBeNull();
  });

  it("removeSearchKeyword：删除不存在的关键词保持历史不变", () => {
    const storage = createMemoryStorage({
      [SEARCH_HISTORY_KEY]: JSON.stringify(["链表"]),
    });
    expect(removeSearchKeyword(storage, "不存在的词")).toEqual(["链表"]);
  });

  it("clearSearchHistory：一键清空并移除存储 key", () => {
    const storage = createMemoryStorage({
      [SEARCH_HISTORY_KEY]: JSON.stringify(["链表", "动态规划"]),
    });
    expect(clearSearchHistory(storage)).toEqual([]);
    expect(storage.getItem(SEARCH_HISTORY_KEY)).toBeNull();
  });
});
