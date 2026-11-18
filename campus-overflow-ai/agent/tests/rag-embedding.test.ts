// RAG embedding：批量、超时/取消、维度校验与离线哈希 provider。
import { describe, expect, it, vi } from "vitest";

import {
  createHashEmbeddingProvider,
  createOpenAICompatibleEmbeddingProvider,
  resolveEmbeddingConfig,
} from "../src/knowledge/rag/embedding.js";

const responseOf = (vectors: number[][]): Response => new Response(JSON.stringify({
  data: vectors.map(embedding => ({ embedding })),
}), { status: 200, headers: { "content-type": "application/json" } });

describe("OpenAI 兼容 embedding provider", () => {
  it("按批量发送并保持返回顺序", async () => {
    const calls: { url: string; body: unknown; authorization: string | null }[] = [];
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { input: string[] };
      calls.push({
        url: String(input),
        body,
        authorization: new Headers(init?.headers).get("authorization"),
      });
      return responseOf(body.input.map((_, index) => [index + 1, 0, 0]));
    });
    const provider = createOpenAICompatibleEmbeddingProvider({
      baseUrl: "https://embedding.example/v1/",
      apiKey: "secret-key",
      model: "text-embedding-test",
      batchSize: 2,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const vectors = await provider.embed(["a", "b", "c"]);
    expect(calls).toHaveLength(2);
    expect(calls[0].url).toBe("https://embedding.example/v1/embeddings");
    expect(calls[0].authorization).toBe("Bearer secret-key");
    expect((calls[0].body as { input: string[] }).input).toEqual(["a", "b"]);
    expect((calls[1].body as { input: string[] }).input).toEqual(["c"]);
    expect(vectors).toEqual([[1, 0, 0], [2, 0, 0], [1, 0, 0]]);
    expect(provider.dimensions).toBe(3);
  });

  it("返回条数或维度不一致时拒绝", async () => {
    const wrongCount = createOpenAICompatibleEmbeddingProvider({
      baseUrl: "https://embedding.example/v1",
      apiKey: "k",
      model: "m",
      fetchImpl: (async () => responseOf([[1, 2]])) as unknown as typeof fetch,
    });
    await expect(wrongCount.embed(["a", "b"])).rejects.toThrow("返回条数与请求不一致");

    let call = 0;
    const wrongDimension = createOpenAICompatibleEmbeddingProvider({
      baseUrl: "https://embedding.example/v1",
      apiKey: "k",
      model: "m",
      dimensions: 3,
      batchSize: 1,
      fetchImpl: (async () => {
        call += 1;
        return responseOf(call === 1 ? [[1, 2, 3]] : [[1, 2]]);
      }) as unknown as typeof fetch,
    });
    await expect(wrongDimension.embed(["a", "b"])).rejects.toThrow("维度与配置不一致");
  });

  it("HTTP 错误不泄漏 API Key", async () => {
    const provider = createOpenAICompatibleEmbeddingProvider({
      baseUrl: "https://embedding.example/v1",
      apiKey: "secret-key",
      model: "m",
      fetchImpl: (async () => new Response("denied", { status: 401 })) as unknown as typeof fetch,
    });
    await expect(provider.embed(["a"])).rejects.toThrow("HTTP 401");
    await expect(provider.embed(["a"])).rejects.not.toThrow("secret-key");
  });

  it("已取消的信号不再发起请求", async () => {
    const fetchImpl = vi.fn();
    const provider = createOpenAICompatibleEmbeddingProvider({
      baseUrl: "https://embedding.example/v1",
      apiKey: "k",
      model: "m",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const controller = new AbortController();
    controller.abort();
    await expect(provider.embed(["a"], controller.signal)).rejects.toThrow("已取消");
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("embedding 配置解析", () => {
  it("默认关闭时不读取任何凭证", () => {
    expect(resolveEmbeddingConfig({})).toBeNull();
    expect(resolveEmbeddingConfig({ RAG_ENABLED: "false", RAG_EMBEDDING_API_KEY: "secret" })).toBeNull();
  });

  it("开启但配置不完整时明确报错", () => {
    expect(() => resolveEmbeddingConfig({ RAG_ENABLED: "true" })).toThrow("配置不完整");
  });

  it("解析批量、超时与可选维度", () => {
    expect(resolveEmbeddingConfig({
      RAG_ENABLED: "true",
      RAG_EMBEDDING_BASE_URL: "https://embedding.example/v1",
      RAG_EMBEDDING_API_KEY: "key",
      RAG_EMBEDDING_MODEL: "embedding-3",
      RAG_EMBEDDING_BATCH_SIZE: "16",
      RAG_EMBEDDING_TIMEOUT_MS: "5000",
      RAG_EMBEDDING_DIMENSIONS: "1024",
    })).toMatchObject({ batchSize: 16, timeoutMs: 5000, dimensions: 1024 });
  });
});

describe("离线哈希 embedding", () => {
  it("确定、归一化，且不声称语义效果", async () => {
    const provider = createHashEmbeddingProvider({ dimensions: 64 });
    const [first, again, other] = await provider.embed(["线性代数", "线性代数", "操作系统"]);
    expect(first).toEqual(again);
    expect(first).not.toEqual(other);
    const norm = Math.sqrt(first.reduce((sum, value) => sum + value * value, 0));
    expect(norm).toBeCloseTo(1, 6);
    expect(provider.model).toBe("fixture-hash");
  });
});
