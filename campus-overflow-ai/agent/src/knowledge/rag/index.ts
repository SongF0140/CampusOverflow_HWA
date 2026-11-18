/** RAG 检索主干：HNSW 稠密召回 + BM25 关键词召回 + RRF 融合。 */

import { Bm25Index } from "./bm25.js";
import { HnswIndex } from "./hnsw.js";
import { tokenize } from "./tokenize.js";
import type {
  EmbeddingProvider,
  RagChunk,
  RagHit,
  RagIndexOptions,
  RagSearchOptions,
  RagSearchResult,
} from "./types.js";

const assertRange = (value: number, name: string, min: number, max: number): void => {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} 必须是 ${min}～${max} 的整数`);
  }
};

interface FusedChunk {
  chunk: RagChunk;
  score: number;
  denseRank?: number;
  keywordRank?: number;
}

export class RagIndex {
  private constructor(
    private readonly chunks: readonly RagChunk[],
    private readonly byId: ReadonlyMap<string, RagChunk>,
    private readonly embedder: EmbeddingProvider,
    private readonly hnsw: HnswIndex,
    private readonly bm25: Bm25Index,
    private readonly rrfK: number,
  ) {}

  static async build(options: RagIndexOptions): Promise<RagIndex> {
    if (options.chunks.length === 0) throw new Error("RAG 索引至少需要一个片段");
    const known = new Set<string>();
    for (const chunk of options.chunks) {
      if (!chunk.id.trim()) throw new Error("RAG 片段 id 不能为空");
      if (known.has(chunk.id)) throw new Error(`RAG 片段 id 重复：${chunk.id}`);
      known.add(chunk.id);
    }
    const vectors = await options.embedder.embed(
      options.chunks.map(chunk => `${chunk.title ?? ""}\n${chunk.text}`),
    );
    if (vectors.length !== options.chunks.length) {
      throw new Error("embedding 返回条数与片段数不一致");
    }
    const dimensions = vectors[0]?.length ?? 0;
    if (dimensions === 0) throw new Error("embedding 返回空向量");
    if (vectors.some(vector => vector.length !== dimensions)) {
      throw new Error("embedding 返回向量维度不一致");
    }
    const hnsw = new HnswIndex({ dimensions, ...options.hnsw });
    for (const vector of vectors) hnsw.add(vector);
    const bm25 = new Bm25Index(options.chunks.map(chunk => ({
      id: chunk.id,
      tokens: tokenize(`${chunk.title ?? ""} ${chunk.text}`),
    })));
    const rrfK = options.rrfK ?? 60;
    assertRange(rrfK, "RRF k", 1, 1000);
    return new RagIndex(
      options.chunks,
      new Map(options.chunks.map(chunk => [chunk.id, chunk])),
      options.embedder,
      hnsw,
      bm25,
      rrfK,
    );
  }

  get size(): number {
    return this.chunks.length;
  }

  async search(query: string, options: RagSearchOptions = {}): Promise<RagSearchResult> {
    const trimmed = query.trim();
    if (!trimmed) throw new Error("RAG 查询不能为空");
    const topN = options.topN ?? 20;
    const topK = options.topK ?? 5;
    assertRange(topN, "topN", 1, 1000);
    assertRange(topK, "topK", 1, topN);

    // 课程过滤在召回后执行，先多取一些候选，避免过滤后不足 topN。
    const fetchSize = options.courseId
      ? Math.max(topN * 4, topN + 20)
      : Math.max(topN * 2, topN + 10);
    // 候选数可能超过默认 efSearch；至少按候选数探索，避免 HNSW 参数校验失败。
    const efSearch = Math.max(options.efSearch ?? 64, fetchSize);
    const [queryVector] = await this.embedder.embed([trimmed]);
    if (!queryVector) throw new Error("embedding 返回空查询向量");

    const denseChunks = this.hnsw.search(queryVector, fetchSize, efSearch)
      .map(hit => this.chunks[hit.id])
      .filter(chunk => !options.courseId || chunk.courseId === options.courseId)
      .slice(0, topN);

    const keywordChunks = this.bm25.search(tokenize(trimmed), fetchSize)
      .map(hit => this.byId.get(hit.id))
      .filter((chunk): chunk is RagChunk => {
        if (!chunk) return false;
        return !options.courseId || chunk.courseId === options.courseId;
      })
      .slice(0, topN);

    const fused = new Map<string, FusedChunk>();
    const addRank = (chunk: RagChunk, rank: number, channel: "dense" | "keyword"): void => {
      const current = fused.get(chunk.id) ?? { chunk, score: 0 };
      current.score += 1 / (this.rrfK + rank);
      if (channel === "dense") current.denseRank = rank;
      else current.keywordRank = rank;
      fused.set(chunk.id, current);
    };
    denseChunks.forEach((chunk, index) => addRank(chunk, index + 1, "dense"));
    keywordChunks.forEach((chunk, index) => addRank(chunk, index + 1, "keyword"));

    const ordered = [...fused.values()].sort((left, right) =>
      right.score - left.score || left.chunk.id.localeCompare(right.chunk.id));
    const hits: RagHit[] = ordered.slice(0, topK).map(item => ({
      chunkId: item.chunk.id,
      cardId: item.chunk.cardId,
      courseId: item.chunk.courseId,
      kind: item.chunk.kind,
      title: item.chunk.title,
      text: item.chunk.text,
      score: item.score,
      denseRank: item.denseRank,
      keywordRank: item.keywordRank,
    }));
    return {
      hits,
      diagnostics: {
        denseCandidates: denseChunks.length,
        keywordCandidates: keywordChunks.length,
        fusedCandidates: fused.size,
      },
    };
  }
}
