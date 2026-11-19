/** Cross-testing 公共类型：数据、切分、检索与指标。 */

export interface GoldItem {
  quote: string;
}

export interface DatasetQuery {
  id: string;
  query: string;
  type: "single_fact" | "cross_card" | "exact_identifier" | "unanswerable" | string;
  gold: GoldItem[];
}

export interface Card {
  id: string;
  title: string;
  summary: string;
  body: string;
}

export interface Document {
  id: string;
  course_id: number;
  title: string;
  cards: Card[];
}

export interface Dataset {
  name: string;
  notes?: string;
  documents: Document[];
  queries: DatasetQuery[];
}

export interface Chunk {
  id: string;
  text: string;
  cardId: string;
  documentId: string;
  courseId: number;
  kind: "summary" | "body" | "fixed";
}

export interface VariantHit {
  chunk: Chunk;
  score: number;
}

export interface QueryMetric {
  queryId: string;
  type: string;
  recall: number;
  allEvidence: boolean;
  mrr: number;
  contextPrecision: number;
  contextChars: number;
  latencyMs: number;
}

export interface VariantMetrics {
  name: string;
  description: string;
  perQuery: QueryMetric[];
  meanRecall: number;
  allEvidenceRate: number;
  meanMrr: number;
  meanContextPrecision: number;
  meanContextChars: number;
  p95LatencyMs: number;
  noAnswerHitRate: number;
}

export interface Comparison {
  baseline: string;
  treatment: string;
  metric: "meanRecall" | "meanContextPrecision" | "meanContextChars" | "meanMrr";
  meanDiff: number;
  ciLow: number;
  ciHigh: number;
  pValue: number;
}
