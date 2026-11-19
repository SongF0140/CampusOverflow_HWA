// RAG 只读工具：课程绑定、严格入参、降级与不可用返回。
import { describe, expect, it, vi } from "vitest";

import { createHashEmbeddingProvider } from "../src/knowledge/rag/embedding.js";
import { RagIndex } from "../src/knowledge/rag/index.js";
import type { RagChunk } from "../src/knowledge/rag/types.js";
import type { ToolExecutionContext } from "../src/tools/registry.js";
import { createSearchKnowledgeTool } from "../src/tools/search-knowledge.js";

const chunks: RagChunk[] = [
  { id: "db#deadlock", cardId: "db", courseId: 1, kind: "body", title: "数据库", text: "死锁检测与预防" },
  { id: "os#schedule", cardId: "os", courseId: 2, kind: "body", title: "操作系统", text: "进程调度时间片轮转" },
];

const context = {} as ToolExecutionContext;

const buildIndex = async (): Promise<RagIndex> => RagIndex.build({
  chunks,
  embedder: createHashEmbeddingProvider({ dimensions: 64 }),
});

describe("searchKnowledge 工具", () => {
  it("只返回当前课程片段并映射为蛇形字段", async () => {
    const index = await buildIndex();
    const tool = createSearchKnowledgeTool(async () => index, 1);
    const result = await tool.execute!({ query: "死锁", limit: 2 }, context) as {
      configured: boolean;
      hits: { chunk_id: string; card_id: string; kind: string; text: string }[];
    };
    expect(result.configured).toBe(true);
    expect(result.hits[0]?.chunk_id).toBe("db#deadlock");
    expect(result.hits[0]?.card_id).toBe("db");
    expect(result.hits.every(hit => hit.chunk_id.startsWith("db#"))).toBe(true);
  });

  it("拒绝模型传入 courseId 或其他额外字段", async () => {
    const index = await buildIndex();
    const tool = createSearchKnowledgeTool(async () => index, 1);
    await expect(tool.execute!({ query: "死锁", courseId: 2 }, context)).rejects.toThrow();
  });

  it("先校验课程权限，拒绝时不构建或读取索引", async () => {
    const index = await buildIndex();
    const getIndex = vi.fn(async () => index);
    const deny = vi.fn(async () => { throw new Error("无权访问该课程资料"); });
    const tool = createSearchKnowledgeTool(getIndex, 1, deny);
    await expect(tool.execute!({ query: "死锁" }, context)).rejects.toThrow("无权访问");
    expect(deny).toHaveBeenCalledTimes(1);
    expect(getIndex).not.toHaveBeenCalled();
  });

  it("索引不可用时返回 configured=false", async () => {
    const tool = createSearchKnowledgeTool(async () => undefined, 1);
    const result = await tool.execute!({ query: "死锁" }, context) as { configured: boolean; hits: unknown[] };
    expect(result).toEqual({ configured: false, hits: [] });
  });

  it("索引构建抛错时降级且不阻断问答", async () => {
    const tool = createSearchKnowledgeTool(async () => { throw new Error("catalog broken"); }, 1);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const result = await tool.execute!({ query: "死锁" }, context) as {
      configured: boolean;
      hits: unknown[];
      degraded?: boolean;
    };
    expect(result).toMatchObject({ configured: false, hits: [], degraded: true });
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("rag_tool_index_failed"));
    errorSpy.mockRestore();
  });

  it("检索异常时降级为空结果并标记 degraded", async () => {
    const failing = {
      search: vi.fn(async () => { throw new Error("embedding down"); }),
    } as unknown as RagIndex;
    const tool = createSearchKnowledgeTool(async () => failing, 1);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const result = await tool.execute!({ query: "死锁" }, context) as { configured: boolean; hits: unknown[]; degraded?: boolean };
    expect(result).toMatchObject({ configured: true, hits: [], degraded: true });
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("rag_tool_search_failed"));
    errorSpy.mockRestore();
  });
});
