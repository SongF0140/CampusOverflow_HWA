/** RAG 评测：召回层指标与延迟；fixture 只验证管线，不代表真实模型效果。 */

import type { RagIndex } from "./index.js";

export interface RagEvalQuery {
  id: string;
  query: string;
  /** 无答案题传空数组 */
  goldChunkIds: readonly string[];
  type?: string;
}

export interface RagEvalOptions {
  topK?: number;
  topN?: number;
}

export interface RagEvalQueryResult {
  id: string;
  goldCount: number;
  recallAtK: number;
  recallAtN: number;
  allGoldAtN: boolean;
  reciprocalRank: number;
  zeroRecall: boolean;
  latencyMs: number;
  hitCount: number;
}

export interface RagEvalReport {
  queries: number;
  answerableQueries: number;
  noAnswerQueries: number;
  recallAtK: number;
  recallAtN: number;
  allEvidenceRecallAtN: number;
  zeroRecallRate: number;
  mrr: number;
  noAnswerHitRate: number;
  p95LatencyMs: number;
  perQuery: RagEvalQueryResult[];
}

const mean = (values: readonly number[]): number =>
  values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;

const percentile = (values: readonly number[], ratio: number): number => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1);
  return sorted[index];
};

export const evaluateRag = async (
  index: RagIndex,
  queries: readonly RagEvalQuery[],
  options: RagEvalOptions = {},
): Promise<RagEvalReport> => {
  const topK = options.topK ?? 5;
  const topN = options.topN ?? 20;
  if (topK <= 0 || topN < topK) throw new Error("评测要求 topN 不小于 topK 且均为正数");
  const perQuery: RagEvalQueryResult[] = [];
  const latencies: number[] = [];
  let noAnswerQueries = 0;
  let noAnswerHits = 0;

  for (const item of queries) {
    const startedAt = performance.now();
    const result = await index.search(item.query, { topN, topK: topN });
    const latencyMs = performance.now() - startedAt;
    latencies.push(latencyMs);
    const retrieved = result.hits.map(hit => hit.chunkId);
    const gold = [...new Set(item.goldChunkIds)];
    if (gold.length === 0) {
      noAnswerQueries += 1;
      if (retrieved.length > 0) noAnswerHits += 1;
      perQuery.push({
        id: item.id, goldCount: 0, recallAtK: 0, recallAtN: 0, allGoldAtN: retrieved.length === 0,
        reciprocalRank: 0, zeroRecall: false, latencyMs, hitCount: retrieved.length,
      });
      continue;
    }
    const topKIds = new Set(retrieved.slice(0, topK));
    const topNIds = new Set(retrieved.slice(0, topN));
    const hitAtK = gold.filter(id => topKIds.has(id)).length;
    const hitAtN = gold.filter(id => topNIds.has(id)).length;
    const firstGold = retrieved.findIndex(id => gold.includes(id));
    perQuery.push({
      id: item.id,
      goldCount: gold.length,
      recallAtK: hitAtK / gold.length,
      recallAtN: hitAtN / gold.length,
      allGoldAtN: hitAtN === gold.length,
      reciprocalRank: firstGold >= 0 ? 1 / (firstGold + 1) : 0,
      zeroRecall: hitAtN === 0,
      latencyMs,
      hitCount: retrieved.length,
    });
  }

  const answerable = perQuery.filter(item => item.goldCount > 0);
  return {
    queries: queries.length,
    answerableQueries: answerable.length,
    noAnswerQueries,
    recallAtK: mean(answerable.map(item => item.recallAtK)),
    recallAtN: mean(answerable.map(item => item.recallAtN)),
    allEvidenceRecallAtN: answerable.length === 0
      ? 0
      : answerable.filter(item => item.allGoldAtN).length / answerable.length,
    zeroRecallRate: answerable.length === 0
      ? 0
      : answerable.filter(item => item.zeroRecall).length / answerable.length,
    mrr: mean(answerable.map(item => item.reciprocalRank)),
    noAnswerHitRate: noAnswerQueries === 0 ? 0 : noAnswerHits / noAnswerQueries,
    p95LatencyMs: percentile(latencies, 0.95),
    perQuery,
  };
};
