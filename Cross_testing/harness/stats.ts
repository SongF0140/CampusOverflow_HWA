/** 配对统计：bootstrap 置信区间与 Wilcoxon 符号秩检验。 */

import type { Comparison, VariantMetrics } from "./types.js";

const mulberry32 = (seed: number): (() => number) => {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
};

const percentile = (sorted: readonly number[], ratio: number): number => {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.floor(ratio * (sorted.length - 1))));
  return sorted[index] ?? 0;
};

export const bootstrapCI = (
  values: readonly number[],
  iterations = 10_000,
  seed = 42,
): { mean: number; low: number; high: number } => {
  if (values.length === 0) return { mean: 0, low: 0, high: 0 };
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const random = mulberry32(seed);
  const means: number[] = [];
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    let sum = 0;
    for (let index = 0; index < values.length; index += 1) {
      sum += values[Math.floor(random() * values.length)] ?? 0;
    }
    means.push(sum / values.length);
  }
  means.sort((left, right) => left - right);
  return { mean, low: percentile(means, 0.025), high: percentile(means, 0.975) };
};

const erf = (value: number): number => {
  const sign = value < 0 ? -1 : 1;
  const x = Math.abs(value);
  const t = 1 / (1 + 0.3275911 * x);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return sign * y;
};

const normalCdf = (value: number): number => 0.5 * (1 + erf(value / Math.SQRT2));

export const wilcoxonSignedRank = (values: readonly number[]): { pValue: number; n: number } => {
  const differences = values.filter(value => value !== 0);
  const n = differences.length;
  if (n === 0) return { pValue: 1, n: 0 };
  const ranked = differences
    .map(value => ({ absolute: Math.abs(value), sign: Math.sign(value) }))
    .sort((left, right) => left.absolute - right.absolute)
    .map((item, index) => ({ ...item, rank: index + 1 }));
  // 并列绝对差取平均秩，并记录 tie 组用于方差修正。
  const tieGroups: number[] = [];
  for (let index = 0; index < ranked.length;) {
    let end = index;
    while (end + 1 < ranked.length && ranked[end + 1]?.absolute === ranked[index]?.absolute) end += 1;
    const groupSize = end - index + 1;
    if (groupSize > 1) tieGroups.push(groupSize);
    const averageRank = (index + 1 + end + 1) / 2;
    for (let cursor = index; cursor <= end; cursor += 1) {
      const item = ranked[cursor];
      if (item) item.rank = averageRank;
    }
    index = end + 1;
  }
  const wPlus = ranked.filter(item => item.sign > 0).reduce((sum, item) => sum + item.rank, 0);
  const expected = (n * (n + 1)) / 4;
  const tieCorrection = tieGroups.reduce((sum, size) => sum + size ** 3 - size, 0);
  const variance = (n * (n + 1) * (2 * n + 1)) / 24 - tieCorrection / 48;
  const pValue = variance <= 0
    ? 1
    : Math.min(1, Math.max(0, 2 * (1 - normalCdf(Math.abs(wPlus - expected) / Math.sqrt(variance)))));
  return { pValue, n };
};

const metricValue = (metrics: VariantMetrics, metric: Comparison["metric"]): Map<string, number> =>
  new Map(metrics.perQuery.map(item => {
    if (metric === "meanRecall") return [item.queryId, item.recall];
    if (metric === "meanContextPrecision") return [item.queryId, item.contextPrecision];
    if (metric === "meanMrr") return [item.queryId, item.mrr];
    return [item.queryId, item.contextChars];
  }));

export const compareVariants = (
  baseline: VariantMetrics,
  treatment: VariantMetrics,
  metric: Comparison["metric"],
): Comparison => {
  const baselineValues = metricValue(baseline, metric);
  const treatmentValues = metricValue(treatment, metric);
  const differences: number[] = [];
  for (const [queryId, value] of treatmentValues) {
    const base = baselineValues.get(queryId);
    if (base === undefined) continue;
    differences.push(value - base);
  }
  const interval = bootstrapCI(differences);
  const { pValue } = wilcoxonSignedRank(differences);
  return {
    baseline: baseline.name,
    treatment: treatment.name,
    metric,
    meanDiff: interval.mean,
    ciLow: interval.low,
    ciHigh: interval.high,
    pValue,
  };
};
