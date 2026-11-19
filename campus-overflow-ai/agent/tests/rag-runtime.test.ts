// RAG 运行时：默认关闭、按目录版本缓存、构建失败隔离。
import { describe, expect, it, vi } from "vitest";

import type { KnowledgeCatalog } from "../src/knowledge/catalog.js";
import { createHashEmbeddingProvider } from "../src/knowledge/rag/embedding.js";
import { createRagRuntime } from "../src/knowledge/rag/runtime.js";

const config = {
  baseUrl: "https://embedding.example/v1",
  apiKey: "key",
  model: "test-embedding",
  batchSize: 32,
  timeoutMs: 1000,
};

const createCatalog = () => {
  let version = "v1";
  let failBody = false;
  let cardCount = 1;
  const catalog = {
    refresh: vi.fn(async () => undefined),
    list: vi.fn(() => ({
      version,
      cards: Array.from({ length: cardCount }, (_, index) => ({
        id: `card-${index}`, domain: "线性代数", course_id: 1, tag_ids: [],
      })),
    })),
    getCard: vi.fn((id: string) => ({
      id,
      domain: "线性代数",
      metadata: {
        course_id: 1,
        tag_ids: [],
        source: { kind: "textbook" as const, id: "book-1" },
        body: { path: "books/linear.md", bookmark: "matrix" },
      },
      summary: "矩阵与线性变换",
    })),
    getBody: vi.fn(async () => {
      if (failBody) throw new Error("目录读取失败");
      return { card_id: "card-0", bookmark: "matrix", content: "矩阵与线性变换", version };
    }),
  };
  return {
    catalog: catalog as unknown as KnowledgeCatalog,
    setVersion: (next: string) => { version = next; },
    setFailBody: (next: boolean) => { failBody = next; },
    setCardCount: (next: number) => { cardCount = next; },
  };
};

const createRuntime = (catalog: KnowledgeCatalog, enabled = true) => {
  let embedCalls = 0;
  const base = createHashEmbeddingProvider({ dimensions: 64 });
  const runtime = createRagRuntime({
    getCatalog: () => catalog,
    enabled: () => enabled,
    resolveConfig: () => config,
    createEmbedder: () => ({
      model: "test-embedding",
      dimensions: 64,
      embed: async (texts, signal) => {
        embedCalls += 1;
        return base.embed(texts, signal);
      },
    }),
  });
  return { runtime, embedCalls: () => embedCalls };
};

describe("RAG 运行时", () => {
  it("默认关闭时直接返回 undefined", async () => {
    const { catalog } = createCatalog();
    const { runtime, embedCalls } = createRuntime(catalog, false);
    await expect(runtime.getIndex(1)).resolves.toBeUndefined();
    expect(embedCalls()).toBe(0);
  });

  it("同一目录版本复用缓存，版本变化后重建", async () => {
    const { catalog, setVersion } = createCatalog();
    const { runtime, embedCalls } = createRuntime(catalog);
    const first = await runtime.getIndex(1);
    const second = await runtime.getIndex(1);
    expect(first).toBeDefined();
    expect(second).toBe(first);
    expect(embedCalls()).toBe(1);

    setVersion("v2");
    const third = await runtime.getIndex(1);
    expect(third).not.toBe(first);
    expect(embedCalls()).toBe(2);
  });

  it("目录读取失败时返回 undefined 且不抛出", async () => {
    const { catalog, setFailBody, setVersion } = createCatalog();
    const { runtime } = createRuntime(catalog);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    setFailBody(true);
    await expect(runtime.getIndex(1)).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("rag_index_build_failed"));

    setFailBody(false);
    setVersion("v2");
    await expect(runtime.getIndex(1)).resolves.toBeDefined();
    errorSpy.mockRestore();
  });

  it("没有知识卡片时不构建索引", async () => {
    const { catalog, setCardCount } = createCatalog();
    const { runtime, embedCalls } = createRuntime(catalog);
    setCardCount(0);
    await expect(runtime.getIndex(1)).resolves.toBeUndefined();
    expect(embedCalls()).toBe(0);
  });

  it("配置解析抛错时返回 undefined 且不抛出", async () => {
    const { catalog } = createCatalog();
    const runtime = createRagRuntime({
      getCatalog: () => catalog,
      enabled: () => true,
      resolveConfig: () => { throw new Error("配置损坏"); },
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await expect(runtime.getIndex(1)).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("rag_index_prepare_failed"));
    errorSpy.mockRestore();
  });
});
