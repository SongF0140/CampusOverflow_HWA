// BM25 关键词分支：排序、IDF、精确标识与边界。
import { describe, expect, it } from "vitest";

import { Bm25Index } from "../src/knowledge/rag/bm25.js";

const index = new Bm25Index([
  { id: "deadlock", tokens: ["死锁", "检测", "预防", "数据库"] },
  { id: "acid", tokens: ["事务", "原子性", "一致性", "数据库"] },
  { id: "quota", tokens: ["错误码", "err_quota_429", "配额", "接口"] },
]);

describe("BM25 关键词检索", () => {
  it("命中查询词的文档排在前面", () => {
    const hits = index.search(["死锁"], 3);
    expect(hits[0]?.id).toBe("deadlock");
    expect(hits.every(hit => hit.score > 0)).toBe(true);
  });

  it("稀有词比常见词权重更高", () => {
    const hits = index.search(["数据库", "死锁"], 3);
    expect(hits[0]?.id).toBe("deadlock");
    expect(hits[1]?.id).toBe("acid");
  });

  it("精确错误码额外加权", () => {
    const hits = index.search(["err_quota_429"], 3);
    expect(hits[0]?.id).toBe("quota");
    expect(hits[0]?.score).toBeGreaterThan(1.5);
  });

  it("空查询、零条数与空索引返回空结果", () => {
    expect(index.search([], 3)).toEqual([]);
    expect(index.search(["死锁"], 0)).toEqual([]);
    expect(new Bm25Index([]).search(["死锁"], 3)).toEqual([]);
  });
});
