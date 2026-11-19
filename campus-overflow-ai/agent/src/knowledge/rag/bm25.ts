/** BM25 关键词分支：中文双字 n-gram 与拉丁标识符共用同一倒排统计。 */

import { isExactIdentifier } from "./tokenize.js";

export interface Bm25Document {
  id: string;
  tokens: readonly string[];
}

interface IndexedDocument {
  id: string;
  termFrequency: Map<string, number>;
  length: number;
}

export interface Bm25Hit {
  id: string;
  score: number;
}

export class Bm25Index {
  private readonly documents: IndexedDocument[] = [];
  private readonly documentFrequency = new Map<string, number>();
  private readonly averageLength: number;

  constructor(
    documents: readonly Bm25Document[],
    private readonly k1 = 1.2,
    private readonly b = 0.75,
  ) {
    let totalLength = 0;
    for (const document of documents) {
      const termFrequency = new Map<string, number>();
      for (const token of document.tokens) {
        termFrequency.set(token, (termFrequency.get(token) ?? 0) + 1);
      }
      this.documents.push({ id: document.id, termFrequency, length: document.tokens.length });
      totalLength += document.tokens.length;
      for (const token of termFrequency.keys()) {
        this.documentFrequency.set(token, (this.documentFrequency.get(token) ?? 0) + 1);
      }
    }
    this.averageLength = documents.length > 0 ? totalLength / documents.length : 0;
  }

  get size(): number {
    return this.documents.length;
  }

  search(queryTokens: readonly string[], limit: number): Bm25Hit[] {
    if (!Number.isInteger(limit) || limit <= 0 || this.documents.length === 0) return [];
    const queryFrequency = new Map<string, number>();
    for (const token of queryTokens) {
      queryFrequency.set(token, (queryFrequency.get(token) ?? 0) + 1);
    }
    const total = this.documents.length;
    const hits: Bm25Hit[] = [];
    for (const document of this.documents) {
      let score = 0;
      for (const [token, frequency] of queryFrequency) {
        const termFrequency = document.termFrequency.get(token);
        if (!termFrequency) continue;
        const documentFrequency = this.documentFrequency.get(token) ?? 0;
        const idf = Math.log(1 + (total - documentFrequency + 0.5) / (documentFrequency + 0.5));
        const denominator = termFrequency + this.k1 * (
          1 - this.b + this.b * document.length / Math.max(this.averageLength, 1)
        );
        score += idf * (termFrequency * (this.k1 + 1)) / denominator * frequency;
        // 精确标识符在课程问答里权重更高，避免被常见双字词淹没。
        if (isExactIdentifier(token)) score += 1.5 * frequency;
      }
      if (score > 0) hits.push({ id: document.id, score });
    }
    hits.sort((left, right) => right.score - left.score || left.id.localeCompare(right.id));
    return hits.slice(0, limit);
  }
}
