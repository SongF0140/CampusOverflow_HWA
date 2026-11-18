/** 检索指标：Recall、全证据、MRR、上下文精度与成本。 */

import { coversAny } from "./mapping.js";
import type { DatasetQuery, QueryMetric, VariantHit, VariantMetrics } from "./types.js";

const percentile = (values: readonly number[], ratio: number): number => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(ratio * sorted.length) - 1));
  return sorted[index] ?? 0;
};

export const evaluateQuery = (
  query: DatasetQuery,
  hits: readonly VariantHit[],
  latencyMs: number,
): QueryMetric => {
  const contextChars = hits.reduce((sum, hit) => sum + hit.chunk.text.length, 0);
  if (query.gold.length === 0) {
    return {
      queryId: query.id,
      type: query.type,
      recall: 0,
      allEvidence: false,
      mrr: 0,
      contextPrecision: 0,
      contextChars,
      latencyMs,
    };
  }
  let covered = 0;
  for (const item of query.gold) if (coversAny(hits, item.quote)) covered += 1;
  const recall = covered / query.gold.length;
  const firstRelevant = hits.findIndex(hit =>
    query.gold.some(item => coversAny([hit], item.quote)),
  );
  const relevantHits = hits.filter(hit =>
    query.gold.some(item => coversAny([hit], item.quote)),
  ).length;
  return {
    queryId: query.id,
    type: query.type,
    recall,
    allEvidence: covered === query.gold.length,
    mrr: firstRelevant >= 0 ? 1 / (firstRelevant + 1) : 0,
    contextPrecision: hits.length > 0 ? relevantHits / hits.length : 0,
    contextChars,
    latencyMs,
  };
};

export const aggregate = (
  name: string,
  description: string,
  queries: readonly DatasetQuery[],
  perQuery: readonly QueryMetric[],
): VariantMetrics => {
  const answerable = new Set(queries.filter(query => query.gold.length > 0).map(query => query.id));
  const unanswerable = new Set(queries.filter(query => query.gold.length === 0).map(query => query.id));
  const answerableMetrics = perQuery.filter(metric => answerable.has(metric.queryId));
  const unanswerableMetrics = perQuery.filter(metric => unanswerable.has(metric.queryId));
  const average = (values: readonly number[]): number =>
    values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
  return {
    name,
    description,
    perQuery: [...perQuery],
    meanRecall: average(answerableMetrics.map(metric => metric.recall)),
    allEvidenceRate: average(answerableMetrics.map(metric => (metric.allEvidence ? 1 : 0))),
    meanMrr: average(answerableMetrics.map(metric => metric.mrr)),
    meanContextPrecision: average(answerableMetrics.map(metric => metric.contextPrecision)),
    meanContextChars: average(answerableMetrics.map(metric => metric.contextChars)),
    p95LatencyMs: percentile(perQuery.map(metric => metric.latencyMs), 0.95),
    noAnswerHitRate: average(unanswerableMetrics.map(metric => (metric.contextChars > 0 ? 1 : 0))),
  };
};
