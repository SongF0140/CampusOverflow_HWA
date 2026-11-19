/**
 * RAG 对比测试入口：
 *   node --import tsx Cross_testing/run-ablation.mjs
 *   node --import tsx Cross_testing/run-ablation.mjs --dataset path/to/dataset.json --top-k 5
 *
 * fixture 使用确定性哈希向量，仅验证对比管线；真实结论必须使用真实教材、真实 embedding 与人工标注。
 */

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createHashEmbeddingProvider } from "../campus-overflow-ai/agent/src/knowledge/rag/embedding.ts";
import { loadDataset } from "./harness/dataset.ts";
import { aggregate, evaluateQuery } from "./harness/metrics.ts";
import { compareVariants } from "./harness/stats.ts";
import { buildVariant, buildVariantDefinitions } from "./harness/variants.ts";

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const valueOf = (flag, fallback) => {
  const index = args.indexOf(flag);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const datasetPath = resolve(valueOf("--dataset", resolve(here, "datasets/rag-gold.fixture.json")));
const outputPath = resolve(valueOf("--out", resolve(here, "results/ablation.md")));
const topK = Number(valueOf("--top-k", "5")) || 5;
const iterations = Number(valueOf("--iterations", "10000")) || 10000;

const format = value => Number(value.toFixed(3));
const interval = comparison =>
  `[${comparison.ciLow >= 0 ? "+" : ""}${format(comparison.ciLow)}, ${comparison.ciHigh >= 0 ? "+" : ""}${format(comparison.ciHigh)}]`;

const main = async () => {
  const dataset = await loadDataset(datasetPath);
  const embedder = createHashEmbeddingProvider({ dimensions: 192 });
  console.error(`[cross-testing] 数据集：${dataset.name}`);
  console.error("[cross-testing] 使用确定性哈希向量；该结果只验证对比管线，不代表真实检索质量。");

  const results = [];
  for (const definition of buildVariantDefinitions(dataset)) {
    const variant = await buildVariant(definition, embedder);
    const perQuery = [];
    for (const query of dataset.queries) {
      const started = performance.now();
      const hits = await variant.search(query.query, topK);
      const latencyMs = performance.now() - started;
      perQuery.push(evaluateQuery(query, hits, latencyMs));
    }
    results.push(aggregate(definition.name, definition.description, dataset.queries, perQuery));
  }

  const baseline = results[0];
  const rows = results.map(result => {
    if (result.name === baseline.name) {
      return { result, recall: null, precision: null, chars: null };
    }
    return {
      result,
      recall: compareVariants(baseline, result, "meanRecall"),
      precision: compareVariants(baseline, result, "meanContextPrecision"),
      chars: compareVariants(baseline, result, "meanContextChars"),
    };
  });

  const lines = [
    `# RAG 对比测试结果`,
    "",
    `- 数据集：${dataset.name}`,
    `- 题目数：${dataset.queries.length}（有答案 ${dataset.queries.filter(query => query.gold.length > 0).length}，无答案 ${dataset.queries.filter(query => query.gold.length === 0).length}）`,
    `- Top-K：${topK}`,
    `- 向量：确定性哈希向量（仅验证管线）`,
    `- 基线：${baseline.name}`,
    "",
    "| 变体 | 说明 | Recall@K | 全证据率 | MRR | 上下文精度 | 上下文字符 | P95 ms | 无答案命中率 | ΔRecall [95% CI] | p |",
    "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
  ];
  for (const row of rows) {
    const { result } = row;
    const recallText = row.recall
      ? `${row.recall.meanDiff >= 0 ? "+" : ""}${format(row.recall.meanDiff)} ${interval(row.recall)}`
      : "—";
    const pText = row.recall ? format(row.recall.pValue) : "—";
    lines.push(`| ${result.name} | ${result.description} | ${format(result.meanRecall)} | ${format(result.allEvidenceRate)} | ${format(result.meanMrr)} | ${format(result.meanContextPrecision)} | ${format(result.meanContextChars)} | ${format(result.p95LatencyMs)} | ${format(result.noAnswerHitRate)} | ${recallText} | ${pText} |`);
  }
  lines.push(
    "",
    "> 配对比较为“变体减基线”；bootstrap 10,000 次，Wilcoxon 符号秩检验为近似 p 值。合成 fixture 不能作为设计优劣结论。",
    "",
    "## 分题明细",
    "",
    "| 变体 | 题目 | 类型 | Recall | 全证据 | MRR | 上下文精度 | 上下文字符 | 延迟 ms |",
    "| --- | --- | --- | ---: | --- | ---: | ---: | ---: | ---: |",
  );
  for (const result of results) {
    for (const metric of result.perQuery) {
      lines.push(`| ${result.name} | ${metric.queryId} | ${metric.type} | ${format(metric.recall)} | ${metric.allEvidence ? "是" : "否"} | ${format(metric.mrr)} | ${format(metric.contextPrecision)} | ${metric.contextChars} | ${format(metric.latencyMs)} |`);
    }
  }

  const csv = [
    "variant,query,type,recall,all_evidence,mrr,context_precision,context_chars,latency_ms",
    ...results.flatMap(result => result.perQuery.map(metric =>
      [result.name, metric.queryId, metric.type, metric.recall, metric.allEvidence ? 1 : 0,
        metric.mrr, metric.contextPrecision, metric.contextChars, metric.latencyMs.toFixed(3)].join(","),
    )),
  ].join("\n");

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${lines.join("\n")}\n`, "utf8");
  await writeFile(outputPath.replace(/\.md$/, ".csv"), `${csv}\n`, "utf8");
  console.log(lines.join("\n"));
  console.log(`\n结果已写入：${outputPath}`);
};

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
