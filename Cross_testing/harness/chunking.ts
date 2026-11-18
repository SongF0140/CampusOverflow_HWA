/** 切分策略：固定窗口 chunk 与卡片摘要/正文两种表示。 */

import type { Chunk, Dataset, Document } from "./types.js";

export const splitByLength = (text: string, size: number, overlap: number): string[] => {
  if (size <= 0) throw new Error("chunk size 必须大于 0");
  if (overlap < 0 || overlap >= size) throw new Error("chunk overlap 必须大于等于 0 且小于 size");
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= size) return [normalized];
  const step = size - overlap;
  const parts: string[] = [];
  for (let start = 0; start < normalized.length; start += step) {
    const part = normalized.slice(start, start + size).trim();
    if (part.length > 0) parts.push(part);
    if (start + size >= normalized.length) break;
  }
  return parts;
};

const documentText = (document: Document): string =>
  `${document.title}。${document.cards
    .map(card => `${card.title}。${card.summary} ${card.body}`)
    .join(" ")}`;

export const fixedChunks = (dataset: Dataset, size = 180, overlap = 45): Chunk[] =>
  dataset.documents.flatMap(document =>
    splitByLength(documentText(document), size, overlap).map((text, index) => ({
      id: `fixed:${document.id}:${index}`,
      text,
      cardId: "",
      documentId: document.id,
      courseId: document.course_id,
      kind: "fixed" as const,
    })),
  );

export const cardChunks = (dataset: Dataset, size = 180, overlap = 20): Chunk[] =>
  dataset.documents.flatMap(document =>
    document.cards.flatMap(card => {
      const summary: Chunk = {
        id: `card:${card.id}:summary`,
        text: `${card.title}。${card.summary}`,
        cardId: card.id,
        documentId: document.id,
        courseId: document.course_id,
        kind: "summary",
      };
      const bodies = splitByLength(`${card.title}。${card.body}`, size, overlap).map((text, index) => ({
        id: `card:${card.id}:body:${index}`,
        text,
        cardId: card.id,
        documentId: document.id,
        courseId: document.course_id,
        kind: "body" as const,
      }));
      return [summary, ...bodies];
    }),
  );

export const summaryChunks = (dataset: Dataset): Chunk[] =>
  dataset.documents.flatMap(document =>
    document.cards.map(card => ({
      id: `card:${card.id}:summary`,
      text: `${card.title}。${card.summary}`,
      cardId: card.id,
      documentId: document.id,
      courseId: document.course_id,
      kind: "summary" as const,
    })),
  );

export const bodyChunksByCard = (
  dataset: Dataset,
  size = 180,
  overlap = 20,
): Map<string, Chunk[]> => {
  const result = new Map<string, Chunk[]>();
  for (const document of dataset.documents) {
    for (const card of document.cards) {
      const chunks = splitByLength(`${card.title}。${card.body}`, size, overlap).map((text, index) => ({
        id: `card:${card.id}:body:${index}`,
        text,
        cardId: card.id,
        documentId: document.id,
        courseId: document.course_id,
        kind: "body" as const,
      }));
      result.set(card.id, chunks);
    }
  }
  return result;
};
