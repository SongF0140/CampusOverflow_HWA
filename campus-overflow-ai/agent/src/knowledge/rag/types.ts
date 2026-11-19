/** RAG 检索的公共类型；实现依据 docs/RAG树设计与迭代记录.md D-029/D-030。 */

export interface RagChunk {
  id: string;
  cardId: string;
  courseId: number;
  kind: "summary" | "body";
  title?: string;
  text: string;
}

export interface EmbeddingProvider {
  readonly model: string;
  readonly dimensions?: number;
  embed(texts: readonly string[], signal?: AbortSignal): Promise<number[][]>;
}

export interface HnswOptions {
  dimensions: number;
  /** 每个节点的邻居上限，默认 16 */
  m?: number;
  /** 构建时候选队列长度，默认 200 */
  efConstruction?: number;
  /** 查询时候选队列长度，默认 64 */
  efSearch?: number;
  /** 固定随机种子，便于测试复现 */
  seed?: number;
}

export interface RagIndexOptions {
  chunks: readonly RagChunk[];
  embedder: EmbeddingProvider;
  hnsw?: Omit<HnswOptions, "dimensions">;
  /** RRF 常数 k，默认 60 */
  rrfK?: number;
}

export interface RagSearchOptions {
  /** 每路召回数量，默认 20 */
  topN?: number;
  /** 融合后返回数量，默认 5 */
  topK?: number;
  courseId?: number;
  efSearch?: number;
}

export interface RagHit {
  chunkId: string;
  cardId: string;
  courseId: number;
  kind: "summary" | "body";
  title?: string;
  text: string;
  score: number;
  denseRank?: number;
  keywordRank?: number;
}

export interface RagSearchDiagnostics {
  denseCandidates: number;
  keywordCandidates: number;
  fusedCandidates: number;
}

export interface RagSearchResult {
  hits: RagHit[];
  diagnostics: RagSearchDiagnostics;
}
