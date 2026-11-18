/**
 * RAG 评测入口：
 *   node --import tsx scripts/rag-eval.mjs --fixture
 *   node --import tsx scripts/rag-eval.mjs --dataset path/to/dataset.json
 *
 * fixture 使用确定性哈希向量，只验证管线；真实效果必须配置 RAG_EMBEDDING_* 后跑自建 50 题集。
 */
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const args = process.argv.slice(2);
const datasetIndex = args.indexOf("--dataset");
const datasetPath = datasetIndex >= 0 ? args[datasetIndex + 1] : undefined;
// 未指定 --dataset 时默认跑 fixture；指定数据集时以数据集为准。
const useFixture = !datasetPath;
const topK = Number(args[args.indexOf("--top-k") + 1]) || 5;
const topN = Number(args[args.indexOf("--top-n") + 1]) || 20;

const fail = (message) => {
  console.error(message);
  process.exitCode = 1;
};

const validate = (payload) => {
  if (!payload || typeof payload !== "object") throw new Error("数据集必须是 JSON 对象");
  if (!Array.isArray(payload.chunks) || payload.chunks.length === 0) throw new Error("数据集缺少 chunks");
  if (!Array.isArray(payload.queries) || payload.queries.length === 0) throw new Error("数据集缺少 queries");
  for (const chunk of payload.chunks) {
    if (!chunk || typeof chunk.id !== "string" || typeof chunk.text !== "string"
      || typeof chunk.cardId !== "string" || typeof chunk.courseId !== "number") {
      throw new Error("chunk 字段不完整：需要 id/cardId/courseId/text");
    }
  }
  for (const query of payload.queries) {
    if (!query || typeof query.id !== "string" || typeof query.query !== "string"
      || !Array.isArray(query.goldChunkIds)) {
      throw new Error("query 字段不完整：需要 id/query/goldChunkIds");
    }
  }
};

const main = async () => {
  if (!useFixture && !datasetPath) {
    throw new Error("请使用 --fixture 或 --dataset <path>");
  }
  const path = useFixture ? resolve("eval/rag-fixture.json") : resolve(datasetPath);
  const payload = JSON.parse(await readFile(path, "utf8"));
  validate(payload);

  const { createHashEmbeddingProvider, createOpenAICompatibleEmbeddingProvider, resolveEmbeddingConfig } =
    await import("../src/knowledge/rag/embedding.ts");
  const { RagIndex } = await import("../src/knowledge/rag/index.ts");
  const { evaluateRag } = await import("../src/knowledge/rag/eval.ts");

  let embedder;
  if (useFixture) {
    embedder = createHashEmbeddingProvider({ dimensions: 256 });
    console.error("[fixture] 使用确定性哈希向量，仅验证评测管线，不代表语义检索质量。");
  } else {
    const config = resolveEmbeddingConfig();
    if (!config) throw new Error("未开启 RAG：请设置 RAG_ENABLED=true 与 RAG_EMBEDDING_* 配置");
    embedder = createOpenAICompatibleEmbeddingProvider(config);
  }

  const index = await RagIndex.build({ chunks: payload.chunks, embedder });
  const report = await evaluateRag(index, payload.queries, { topK, topN });
  const summary = {
    dataset: payload.name ?? path,
    queries: report.queries,
    answerableQueries: report.answerableQueries,
    noAnswerQueries: report.noAnswerQueries,
    recallAtK: Number(report.recallAtK.toFixed(4)),
    recallAtN: Number(report.recallAtN.toFixed(4)),
    allEvidenceRecallAtN: Number(report.allEvidenceRecallAtN.toFixed(4)),
    zeroRecallRate: Number(report.zeroRecallRate.toFixed(4)),
    mrr: Number(report.mrr.toFixed(4)),
    noAnswerHitRate: Number(report.noAnswerHitRate.toFixed(4)),
    p95LatencyMs: Number(report.p95LatencyMs.toFixed(2)),
  };
  console.log(JSON.stringify(summary, null, 2));
  if (useFixture) console.error("[fixture] 该结果不能写入验收结论；真实 50 题 pilot 需教材与标注数据。");
};

main().catch((error) => fail(error instanceof Error ? error.message : String(error)));
