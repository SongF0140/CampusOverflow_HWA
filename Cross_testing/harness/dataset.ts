/** 数据集读取与结构校验；gold 按原文 quote 标注，便于映射到不同切分。 */

import { readFile } from "node:fs/promises";

import type { Card, Dataset, DatasetQuery, Document } from "./types.js";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const requireString = (value: unknown, field: string): string => {
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(`字段 ${field} 必须是非空字符串`);
  return value;
};

const parseCard = (value: unknown, documentId: string): Card => {
  if (!isRecord(value)) throw new Error(`文档 ${documentId} 的 card 必须是对象`);
  return {
    id: requireString(value.id, `${documentId}.cards[].id`),
    title: requireString(value.title, `${documentId}.cards[].title`),
    summary: requireString(value.summary, `${documentId}.cards[].summary`),
    body: requireString(value.body, `${documentId}.cards[].body`),
  };
};

const parseDocument = (value: unknown): Document => {
  if (!isRecord(value)) throw new Error("documents[] 必须是对象");
  const id = requireString(value.id, "documents[].id");
  if (typeof value.course_id !== "number" || !Number.isInteger(value.course_id)) {
    throw new Error(`文档 ${id} 的 course_id 必须是整数`);
  }
  if (!Array.isArray(value.cards) || value.cards.length === 0) throw new Error(`文档 ${id} 缺少 cards`);
  return {
    id,
    course_id: value.course_id,
    title: requireString(value.title, `${id}.title`),
    cards: value.cards.map(card => parseCard(card, id)),
  };
};

const parseQuery = (value: unknown): DatasetQuery => {
  if (!isRecord(value)) throw new Error("queries[] 必须是对象");
  const id = requireString(value.id, "queries[].id");
  if (!Array.isArray(value.gold)) throw new Error(`query ${id} 缺少 gold 数组`);
  const gold = value.gold.map(item => {
    if (!isRecord(item)) throw new Error(`query ${id} 的 gold 项必须是对象`);
    return { quote: requireString(item.quote, `${id}.gold[].quote`) };
  });
  return {
    id,
    query: requireString(value.query, `${id}.query`),
    type: typeof value.type === "string" ? value.type : "unknown",
    gold,
  };
};

export const parseDataset = (value: unknown): Dataset => {
  if (!isRecord(value)) throw new Error("数据集必须是对象");
  if (!Array.isArray(value.documents) || value.documents.length === 0) throw new Error("数据集缺少 documents");
  if (!Array.isArray(value.queries) || value.queries.length === 0) throw new Error("数据集缺少 queries");
  return {
    name: requireString(value.name, "name"),
    notes: typeof value.notes === "string" ? value.notes : undefined,
    documents: value.documents.map(parseDocument),
    queries: value.queries.map(parseQuery),
  };
};

export const loadDataset = async (path: string): Promise<Dataset> =>
  parseDataset(JSON.parse(await readFile(path, "utf8")));
