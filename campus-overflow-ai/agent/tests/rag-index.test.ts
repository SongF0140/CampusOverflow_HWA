// RAG 检索主干：稠密 + BM25 + RRF，课程过滤与参数校验。
import { describe, expect, it } from "vitest";

import { createHashEmbeddingProvider } from "../src/knowledge/rag/embedding.js";
import { RagIndex } from "../src/knowledge/rag/index.js";
import type { RagChunk } from "../src/knowledge/rag/types.js";

const chunks: RagChunk[] = [
  {
    id: "db#deadlock", cardId: "db", courseId: 1, kind: "body", title: "数据库",
    text: "死锁检测与预防：按固定顺序加锁，必要时回滚事务。",
  },
  {
    id: "db#acid", cardId: "db", courseId: 1, kind: "summary", title: "数据库",
    text: "事务的 ACID 特性包括原子性、一致性、隔离性与持久性。",
  },
  {
    id: "os#schedule", cardId: "os", courseId: 2, kind: "body", title: "操作系统",
    text: "进程调度算法包括先来先服务、短作业优先与时间片轮转。",
  },
  {
    id: "api#quota", cardId: "api", courseId: 1, kind: "body", title: "接口规范",
    text: "错误码 ERR_QUOTA_429 表示配额超限，请稍后重试。",
  },
];

const buildIndex = async (): Promise<RagIndex> => RagIndex.build({
  chunks,
  embedder: createHashEmbeddingProvider({ dimensions: 128 }),
  hnsw: { efSearch: 64, seed: 3 },
});

describe("RAG 检索", () => {
  it("关键词与稠密召回经 RRF 返回相关片段", async () => {
    const index = await buildIndex();
    const result = await index.search("死锁", { topK: 2 });
    expect(result.hits[0].chunkId).toBe("db#deadlock");
    expect(result.hits[0].keywordRank).toBe(1);
    expect(result.hits[0].denseRank).toBeGreaterThan(0);
    expect(result.diagnostics.fusedCandidates).toBeGreaterThan(0);
    expect(result.hits[0].score).toBeCloseTo(1 / 61 + 1 / 61, 6);
  });

  it("精确错误码优先命中", async () => {
    const index = await buildIndex();
    const result = await index.search("ERR_QUOTA_429", { topK: 1 });
    expect(result.hits[0]?.chunkId).toBe("api#quota");
  });

  it("课程过滤后只返回该课程片段", async () => {
    const index = await buildIndex();
    const result = await index.search("死锁", { courseId: 2, topK: 5, topN: 10 });
    expect(result.hits.every(hit => hit.courseId === 2)).toBe(true);
  });

  it("默认 topN 加课程过滤时自动放大 efSearch", async () => {
    const index = await buildIndex();
    const result = await index.search("死锁", { courseId: 1, topN: 20, topK: 3 });
    expect(result.hits.every(hit => hit.courseId === 1)).toBe(true);
  });

  it("拒绝空查询、重复 id 与非法返回条数", async () => {
    await expect(RagIndex.build({
      chunks: [chunks[0], chunks[0]],
      embedder: createHashEmbeddingProvider(),
    })).rejects.toThrow("id 重复");
    const index = await buildIndex();
    await expect(index.search("  ")).rejects.toThrow("不能为空");
    await expect(index.search("死锁", { topN: 2, topK: 3 })).rejects.toThrow("topK");
  });
});
