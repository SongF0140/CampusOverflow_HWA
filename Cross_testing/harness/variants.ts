/** 对比变体：固定 chunk、卡片结构、分层检索、混合召回、Flat/HNSW。 */

import { Bm25Index } from "../../campus-overflow-ai/agent/src/knowledge/rag/bm25.js";
import { HnswIndex } from "../../campus-overflow-ai/agent/src/knowledge/rag/hnsw.js";
import { tokenize } from "../../campus-overflow-ai/agent/src/knowledge/rag/tokenize.js";
import type { EmbeddingProvider } from "../../campus-overflow-ai/agent/src/knowledge/rag/types.js";
import {
  bodyChunksByCard,
  cardChunks,
  fixedChunks,
  summaryChunks,
} from "./chunking.js";
import type { Chunk, Dataset, VariantHit } from "./types.js";

export type RetrievalMode = "dense" | "keyword" | "hybrid";
export type IndexType = "flat" | "hnsw";

export interface VariantDefinition {
  name: string;
  description: string;
  chunks: Chunk[];
  mode: RetrievalMode;
  indexType: IndexType;
  hierarchical?: {
    bodies: Map<string, Chunk[]>;
  };
}

const normalizeVector = (vector: readonly number[]): Float64Array => {
  const result = new Float64Array(vector.length);
  let squared = 0;
  for (let index = 0; index < vector.length; index += 1) {
    const value = vector[index] ?? 0;
    result[index] = value;
    squared += value * value;
  }
  if (squared > 0) {
    const length = Math.sqrt(squared);
    for (let index = 0; index < result.length; index += 1) result[index] /= length;
  }
  return result;
};

const dot = (left: Float64Array, right: Float64Array): number => {
  let sum = 0;
  for (let index = 0; index < left.length; index += 1) sum += (left[index] ?? 0) * (right[index] ?? 0);
  return sum;
};

class VariantIndex {
  private readonly flatVectors: Float64Array[];
  private readonly hnsw: HnswIndex | null;
  private readonly bm25: Bm25Index;
  private readonly byId: Map<string, Chunk>;

  constructor(
    private readonly chunks: readonly Chunk[],
    vectors: readonly (readonly number[])[],
    indexType: IndexType,
  ) {
    this.flatVectors = vectors.map(normalizeVector);
    this.byId = new Map(chunks.map(chunk => [chunk.id, chunk]));
    this.bm25 = new Bm25Index(chunks.map(chunk => ({ id: chunk.id, tokens: tokenize(chunk.text) })));
    if (indexType === "hnsw") {
      const dimensions = this.flatVectors[0]?.length ?? 0;
      this.hnsw = new HnswIndex({ dimensions, m: 16, efConstruction: 200, efSearch: 64, seed: 42 });
      for (const vector of this.flatVectors) this.hnsw.add(vector);
    } else {
      this.hnsw = null;
    }
  }

  private dense(queryVector: readonly number[], limit: number): VariantHit[] {
    const normalized = normalizeVector(queryVector);
    if (this.hnsw) {
      return this.hnsw.search(normalized, limit, Math.max(64, limit))
        .map(hit => {
          const chunk = this.chunks[hit.id];
          return chunk ? { chunk, score: hit.score } : undefined;
        })
        .filter((hit): hit is VariantHit => hit !== undefined);
    }
    return this.flatVectors
      .map((vector, index) => {
        const chunk = this.chunks[index];
        return chunk ? { chunk, score: dot(normalized, vector) } : undefined;
      })
      .filter((hit): hit is VariantHit => hit !== undefined)
      .sort((left, right) => right.score - left.score)
      .slice(0, limit);
  }

  private keyword(query: string, limit: number): VariantHit[] {
    return this.bm25.search(tokenize(query), limit)
      .map(hit => {
        const chunk = this.byId.get(hit.id);
        return chunk ? { chunk, score: hit.score } : undefined;
      })
      .filter((hit): hit is VariantHit => hit !== undefined);
  }

  private hybrid(query: string, queryVector: readonly number[], limit: number, topN: number): VariantHit[] {
    const denseHits = this.dense(queryVector, topN);
    const keywordHits = this.keyword(query, topN);
    const fused = new Map<string, { chunk: Chunk; score: number }>();
    denseHits.forEach((hit, rank) => {
      fused.set(hit.chunk.id, { chunk: hit.chunk, score: 1 / (60 + rank + 1) });
    });
    keywordHits.forEach((hit, rank) => {
      const current = fused.get(hit.chunk.id);
      const score = 1 / (60 + rank + 1);
      if (current) current.score += score;
      else fused.set(hit.chunk.id, { chunk: hit.chunk, score });
    });
    return [...fused.values()]
      .sort((left, right) => right.score - left.score)
      .slice(0, limit);
  }

  search(query: string, queryVector: readonly number[], mode: RetrievalMode, topK: number, topN = 20): VariantHit[] {
    if (mode === "keyword") return this.keyword(query, topK);
    if (mode === "hybrid") return this.hybrid(query, queryVector, topK, topN);
    return this.dense(queryVector, topK);
  }
}

const embedAll = async (embedder: EmbeddingProvider, texts: readonly string[]): Promise<number[][]> => {
  const vectors: number[][] = [];
  for (let start = 0; start < texts.length; start += 32) {
    const batch = await embedder.embed(texts.slice(start, start + 32));
    if (batch.length !== Math.min(32, texts.length - start)) throw new Error("embedding 返回条数与输入不一致");
    vectors.push(...batch);
  }
  return vectors;
};

export interface BuiltVariant {
  definition: VariantDefinition;
  search: (query: string, topK: number) => Promise<VariantHit[]>;
}

export const buildVariant = async (
  definition: VariantDefinition,
  embedder: EmbeddingProvider,
): Promise<BuiltVariant> => {
  const vectors = await embedAll(embedder, definition.chunks.map(chunk => chunk.text));
  const index = new VariantIndex(definition.chunks, vectors, definition.indexType);
  const summaryIndex = definition.hierarchical
    ? new VariantIndex(definition.chunks, vectors, definition.indexType)
    : null;
  const bodies = definition.hierarchical?.bodies;
  return {
    definition,
    search: async (query, topK) => {
      const [queryVector] = await embedder.embed([query]);
      if (!queryVector) throw new Error("embedding 返回空查询向量");
      if (!definition.hierarchical || !summaryIndex || !bodies) {
        return index.search(query, queryVector, definition.mode, topK);
      }
      const hits: VariantHit[] = [];
      const seen = new Set<string>();
      for (const summaryHit of summaryIndex.search(query, queryVector, definition.mode, 20)) {
        const expanded = bodies.get(summaryHit.chunk.cardId) ?? [];
        const candidates = expanded.length > 0 ? expanded : [summaryHit.chunk];
        for (const chunk of candidates) {
          if (seen.has(chunk.id)) continue;
          seen.add(chunk.id);
          hits.push({ chunk, score: summaryHit.score });
          if (hits.length >= topK) return hits;
        }
      }
      return hits;
    },
  };
};

export const buildVariantDefinitions = (dataset: Dataset): VariantDefinition[] => {
  const fixed = fixedChunks(dataset);
  const cards = cardChunks(dataset);
  const summaries = summaryChunks(dataset);
  const bodies = bodyChunksByCard(dataset);
  return [
    {
      name: "fixed-dense-flat",
      description: "固定窗口 chunk + 稠密召回（传统 chunk RAG 基线）",
      chunks: fixed,
      mode: "dense",
      indexType: "flat",
    },
    {
      name: "card-dense-flat",
      description: "卡片摘要/正文相互独立 + 稠密召回",
      chunks: cards,
      mode: "dense",
      indexType: "flat",
    },
    {
      name: "card-hybrid-flat",
      description: "卡片摘要/正文 + 稠密/关键词 RRF",
      chunks: cards,
      mode: "hybrid",
      indexType: "flat",
    },
    {
      name: "card-hierarchical-flat",
      description: "摘要召回卡片后展开正文 + 稠密",
      chunks: summaries,
      mode: "dense",
      indexType: "flat",
      hierarchical: { bodies },
    },
    {
      name: "card-hierarchical-hybrid-flat",
      description: "摘要召回卡片后展开正文 + RRF",
      chunks: summaries,
      mode: "hybrid",
      indexType: "flat",
      hierarchical: { bodies },
    },
    {
      name: "card-hybrid-hnsw",
      description: "卡片摘要/正文 + RRF + HNSW",
      chunks: cards,
      mode: "hybrid",
      indexType: "hnsw",
    },
  ];
};
