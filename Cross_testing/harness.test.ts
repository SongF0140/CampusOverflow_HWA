/** Cross_testing 自检：数据、切分、映射、指标、统计与变体管线。 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createHashEmbeddingProvider } from "../campus-overflow-ai/agent/src/knowledge/rag/embedding.js";
import { splitByLength, cardChunks } from "./harness/chunking.js";
import { loadDataset } from "./harness/dataset.js";
import { covers } from "./harness/mapping.js";
import { aggregate, evaluateQuery } from "./harness/metrics.js";
import { bootstrapCI, wilcoxonSignedRank } from "./harness/stats.js";
import { buildVariant, buildVariantDefinitions } from "./harness/variants.js";
import type { Chunk, VariantHit } from "./harness/types.js";

const here = dirname(fileURLToPath(import.meta.url));
const datasetPath = resolve(here, "datasets/rag-gold.fixture.json");

const chunk = (id: string, text: string, kind: Chunk["kind"] = "body"): Chunk => ({
  id, text, cardId: id.split(":")[1] ?? id, documentId: "doc", courseId: 1, kind,
});

test("数据集可加载，包含有答案与无答案题", async () => {
  const dataset = await loadDataset(datasetPath);
  assert.ok(dataset.documents.length >= 4);
  assert.ok(dataset.queries.some(query => query.gold.length === 0));
  assert.ok(dataset.queries.some(query => query.gold.length > 1));
});

test("固定窗口切分保留 overlap 且不产生空块", () => {
  const text = "abcdefghijklmnopqrstuvwxyz";
  const parts = splitByLength(text, 10, 3);
  assert.equal(parts[0], "abcdefghij");
  assert.equal(parts[1], "hijklmnopq");
  assert.ok(parts.every(part => part.length > 0));
  assert.throws(() => splitByLength(text, 10, 10), /overlap/);
});

test("卡片切分生成摘要与正文片段", async () => {
  const dataset = await loadDataset(datasetPath);
  const chunks = cardChunks(dataset);
  assert.ok(chunks.some(item => item.kind === "summary"));
  assert.ok(chunks.some(item => item.kind === "body"));
  assert.ok(chunks.every(item => item.cardId.length > 0));
});

test("gold quote 支持精确包含与跨边界双字重合", () => {
  assert.equal(covers("事务按固定顺序加锁可以避免循环等待", "按固定顺序加锁"), true);
  assert.equal(covers("按固定顺序加锁", "按固定顺序加锁并设置"), true);
  assert.equal(covers("完全无关的内容", "ERR_QUOTA_429"), false);
});

test("单题指标计算 Recall、全证据、MRR 与上下文精度", () => {
  const query = {
    id: "q", query: "死锁", type: "single_fact",
    gold: [{ quote: "按固定顺序加锁" }, { quote: "回滚代价较小的事务" }],
  };
  const hits: VariantHit[] = [
    { chunk: chunk("a", "事务按固定顺序加锁"), score: 1 },
    { chunk: chunk("b", "无关内容"), score: 0.5 },
  ];
  const metric = evaluateQuery(query, hits, 12);
  assert.equal(metric.recall, 0.5);
  assert.equal(metric.allEvidence, false);
  assert.equal(metric.mrr, 1);
  assert.equal(metric.contextPrecision, 0.5);
  assert.equal(metric.contextChars, 13);
});

test("聚合指标区分有答案与无答案题", () => {
  const queries = [
    { id: "a", query: "", type: "single_fact", gold: [{ quote: "x" }] },
    { id: "b", query: "", type: "unanswerable", gold: [] },
  ];
  const metrics = [
    { queryId: "a", type: "single_fact", recall: 1, allEvidence: true, mrr: 1, contextPrecision: 1, contextChars: 10, latencyMs: 1 },
    { queryId: "b", type: "unanswerable", recall: 0, allEvidence: false, mrr: 0, contextPrecision: 0, contextChars: 10, latencyMs: 2 },
  ];
  const result = aggregate("v", "d", queries, metrics);
  assert.equal(result.meanRecall, 1);
  assert.equal(result.noAnswerHitRate, 1);
});

test("bootstrap 与 Wilcoxon 返回可用统计量", () => {
  const interval = bootstrapCI([0.1, 0.2, 0.3, 0.4], 1000, 7);
  assert.ok(interval.low <= interval.mean && interval.mean <= interval.high);
  const wilcoxon = wilcoxonSignedRank([1, 2, 3, 4, 5]);
  assert.ok(wilcoxon.pValue >= 0 && wilcoxon.pValue <= 1);
  assert.equal(wilcoxonSignedRank([0, 0]).pValue, 1);
});

test("六个变体均可运行，分层变体返回正文片段", async () => {
  const dataset = await loadDataset(datasetPath);
  const embedder = createHashEmbeddingProvider({ dimensions: 96 });
  const definitions = buildVariantDefinitions(dataset);
  assert.equal(definitions.length, 6);
  for (const definition of definitions) {
    const variant = await buildVariant(definition, embedder);
    const hits = await variant.search("如何预防死锁", 5);
    assert.ok(hits.length > 0, `${definition.name} 应返回结果`);
    if (definition.hierarchical) {
      assert.ok(hits.some(hit => hit.chunk.kind === "body"), `${definition.name} 应展开正文`);
    }
  }
});
