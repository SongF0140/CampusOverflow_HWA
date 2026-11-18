/** 从知识目录生成 RAG 片段：卡片摘要 + 正文按段落切块。 */

import type { KnowledgeCatalog } from "../catalog.js";
import type { RagChunk } from "./types.js";

export interface CatalogChunkOptions {
  /** 正文单块最大字符数，默认 1200 */
  maxChars?: number;
}

export const splitBody = (text: string, maxChars: number): string[] => {
  const paragraphs = text.split(/\n{2,}/).map(part => part.trim()).filter(Boolean);
  const chunks: string[] = [];
  let current = "";
  for (const paragraph of paragraphs) {
    if (paragraph.length > maxChars) {
      if (current) {
        chunks.push(current);
        current = "";
      }
      for (let start = 0; start < paragraph.length; start += maxChars) {
        chunks.push(paragraph.slice(start, start + maxChars));
      }
      continue;
    }
    if (!current) current = paragraph;
    else if (current.length + 2 + paragraph.length <= maxChars) current += `\n\n${paragraph}`;
    else {
      chunks.push(current);
      current = paragraph;
    }
  }
  if (current) chunks.push(current);
  return chunks;
};

/**
 * 只读取调用者授权的课程；正文读取沿用目录版本校验。
 * 目录在读取期间变化时 getBody 会抛错，调用方应刷新后重建。
 */
export const collectCatalogChunks = async (
  catalog: KnowledgeCatalog,
  courseIds: readonly number[],
  options: CatalogChunkOptions = {},
): Promise<RagChunk[]> => {
  const maxChars = options.maxChars ?? 1200;
  if (!Number.isInteger(maxChars) || maxChars < 200) {
    throw new Error("RAG 正文块大小必须是至少 200 的整数");
  }
  const index = catalog.list(courseIds);
  const chunks: RagChunk[] = [];
  for (const item of index.cards) {
    const card = catalog.getCard(item.id, courseIds);
    if (!card) continue;
    const title = card.domain;
    chunks.push({
      id: `${item.id}#summary`,
      cardId: item.id,
      courseId: card.metadata.course_id,
      kind: "summary",
      title,
      text: `${card.domain}\n${card.summary}`,
    });
    const body = await catalog.getBody(item.id, courseIds, index.version);
    if (!body) continue;
    splitBody(body.content, maxChars).forEach((part, partIndex) => {
      chunks.push({
        id: `${item.id}#body-${partIndex}`,
        cardId: item.id,
        courseId: card.metadata.course_id,
        kind: "body",
        title,
        text: part,
      });
    });
  }
  return chunks;
};
