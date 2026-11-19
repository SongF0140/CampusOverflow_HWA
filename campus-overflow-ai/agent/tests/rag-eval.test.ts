// RAG 评测指标：召回、全证据召回、零召回、无答案命中与 P95。
import { describe, expect, it, vi } from "vitest";

import { evaluateRag } from "../src/knowledge/rag/eval.js";
import type { RagIndex } from "../src/knowledge/rag/index.js";
import type { RagHit, RagSearchResult } from "../src/knowledge/rag/types.js";

const hit = (chunkId: string): RagHit => ({
  chunkId, cardId: "card", courseId: 1, kind: "body", text: chunkId, score: 1,
});

const stubIndex = (results: Record<string, string[]>): RagIndex => ({
  search: vi.fn(async (query: string): Promise<RagSearchResult> => ({
    hits: (results[query] ?? []).map(hit),
    diagnostics: { denseCandidates: 0, keywordCandidates: 0, fusedCandidates: 0 },
  })),
} as unknown as RagIndex);

describe("RAG 评测", () => {
  it("按 topK/topN 计算召回、MRR 与无答案命中", async () => {
    const index = stubIndex({
      q1: ["a", "x"],
      q2: ["x", "c"],
      q3: ["x"],
    });
    const report = await evaluateRag(index, [
      { id: "q1", query: "q1", goldChunkIds: ["a", "b"] },
      { id: "q2", query: "q2", goldChunkIds: ["c"] },
      { id: "q3", query: "q3", goldChunkIds: [] },
    ], { topK: 1, topN: 2 });
    expect(report.queries).toBe(3);
    expect(report.answerableQueries).toBe(2);
    expect(report.noAnswerQueries).toBe(1);
    expect(report.recallAtK).toBeCloseTo(0.25, 6);
    expect(report.recallAtN).toBeCloseTo(0.75, 6);
    expect(report.allEvidenceRecallAtN).toBe(0.5);
    expect(report.zeroRecallRate).toBe(0);
    expect(report.mrr).toBeCloseTo(0.75, 6);
    expect(report.noAnswerHitRate).toBe(1);
    expect(report.p95LatencyMs).toBeGreaterThanOrEqual(0);
  });

  it("零召回与全证据召回可区分", async () => {
    const index = stubIndex({ q1: ["x", "y"], q2: ["a", "b"] });
    const report = await evaluateRag(index, [
      { id: "q1", query: "q1", goldChunkIds: ["a"] },
      { id: "q2", query: "q2", goldChunkIds: ["a", "b"] },
    ], { topK: 2, topN: 2 });
    expect(report.zeroRecallRate).toBe(0.5);
    expect(report.allEvidenceRecallAtN).toBe(0.5);
  });

  it("空问题集返回零值", async () => {
    const report = await evaluateRag(stubIndex({}), [], { topK: 3, topN: 5 });
    expect(report.queries).toBe(0);
    expect(report.recallAtK).toBe(0);
    expect(report.p95LatencyMs).toBe(0);
  });

  it("拒绝 topN 小于 topK", async () => {
    await expect(evaluateRag(stubIndex({}), [], { topK: 5, topN: 3 })).rejects.toThrow("topN");
  });
});
