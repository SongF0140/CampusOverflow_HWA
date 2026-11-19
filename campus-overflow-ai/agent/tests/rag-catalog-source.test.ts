// 目录转 RAG 片段：摘要 + 正文切块、课程授权与版本传递。
import { describe, expect, it, vi } from "vitest";

import type { KnowledgeCatalog } from "../src/knowledge/catalog.js";
import { collectCatalogChunks, splitBody } from "../src/knowledge/rag/catalog-source.js";

const catalogOf = (content = "第一段\n\n第二段") => {
  const list = vi.fn(() => ({
    version: "v1",
    cards: [{ id: "linear", domain: "线性代数", course_id: 1, tag_ids: [] }],
  }));
  const getCard = vi.fn(() => ({
    id: "linear",
    domain: "线性代数",
    metadata: {
      course_id: 1,
      tag_ids: [1],
      source: { kind: "textbook" as const, id: "book-1" },
      body: { path: "books/linear.md", bookmark: "matrix" },
    },
    summary: "矩阵与线性变换",
  }));
  const getBody = vi.fn(async () => ({
    card_id: "linear", bookmark: "matrix", content, version: "v1",
  }));
  return { catalog: { list, getCard, getBody } as unknown as KnowledgeCatalog, list, getBody };
};

describe("目录转 RAG 片段", () => {
  it("生成摘要与正文片段，并传递目录版本", async () => {
    const { catalog, getBody } = catalogOf();
    const chunks = await collectCatalogChunks(catalog, [1]);
    expect(chunks.map(chunk => chunk.id)).toEqual(["linear#summary", "linear#body-0"]);
    expect(chunks[0]).toMatchObject({ kind: "summary", courseId: 1, title: "线性代数" });
    expect(chunks[1].text).toContain("第一段");
    expect(getBody).toHaveBeenCalledWith("linear", [1], "v1");
  });

  it("超长段落按 maxChars 硬切", async () => {
    const { catalog } = catalogOf("甲".repeat(250));
    const chunks = await collectCatalogChunks(catalog, [1], { maxChars: 200 });
    expect(chunks.filter(chunk => chunk.kind === "body").map(chunk => chunk.text.length)).toEqual([200, 50]);
  });

  it("splitBody 合并短段落并处理空文本", () => {
    expect(splitBody("a\n\nb", 10)).toEqual(["a\n\nb"]);
    expect(splitBody("a\n\nb", 2)).toEqual(["a", "b"]);
    expect(splitBody("", 10)).toEqual([]);
  });

  it("拒绝过小的正文块配置", async () => {
    const { catalog } = catalogOf();
    await expect(collectCatalogChunks(catalog, [1], { maxChars: 100 })).rejects.toThrow("至少 200");
  });
});
