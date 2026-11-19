/** Embedding provider：默认关闭；测试与离线 fixture 不依赖真实网络。 */

import { tokenize } from "./tokenize.js";
import type { EmbeddingProvider } from "./types.js";

export interface OpenAICompatibleEmbeddingOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
  /** 单次请求文本数，默认 32 */
  batchSize?: number;
  /** 单次请求超时，默认 30 秒 */
  timeoutMs?: number;
  /** 首次响应后校验维度；不传则以首次响应为准 */
  dimensions?: number;
  fetchImpl?: typeof fetch;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const assertPositiveInteger = (value: number, name: string, max: number): number => {
  if (!Number.isInteger(value) || value <= 0 || value > max) {
    throw new Error(`${name} 必须是 1～${max} 的整数`);
  }
  return value;
};

const parseEmbeddingResponse = (
  payload: unknown,
  expectedCount: number,
  expectedDimensions: number | undefined,
): { vectors: number[][]; dimensions: number } => {
  if (!isRecord(payload) || !Array.isArray(payload.data)) {
    throw new Error("embedding 服务响应格式不正确");
  }
  if (payload.data.length !== expectedCount) {
    throw new Error("embedding 服务返回条数与请求不一致");
  }
  const vectors = payload.data.map((item) => {
    if (!isRecord(item) || !Array.isArray(item.embedding) || item.embedding.length === 0) {
      throw new Error("embedding 服务返回空向量");
    }
    const vector = item.embedding.map((value) => {
      if (typeof value !== "number" || !Number.isFinite(value)) {
        throw new Error("embedding 服务返回非数值向量");
      }
      return value;
    });
    return vector;
  });
  const dimensions = vectors[0]?.length ?? 0;
  if (vectors.some(vector => vector.length !== dimensions)) {
    throw new Error("embedding 服务返回向量维度不一致");
  }
  if (expectedDimensions !== undefined && dimensions !== expectedDimensions) {
    throw new Error(`embedding 维度与配置不一致：期望 ${expectedDimensions}，实际 ${dimensions}`);
  }
  return { vectors, dimensions };
};

export const createOpenAICompatibleEmbeddingProvider = (
  options: OpenAICompatibleEmbeddingOptions,
): EmbeddingProvider => {
  const baseUrl = options.baseUrl.trim().replace(/\/+$/, "");
  const apiKey = options.apiKey.trim();
  const model = options.model.trim();
  if (!baseUrl || !apiKey || !model) {
    throw new Error("embedding 配置不完整：baseUrl、apiKey、model 均不能为空");
  }
  const batchSize = assertPositiveInteger(options.batchSize ?? 32, "embedding 批量大小", 128);
  const timeoutMs = assertPositiveInteger(options.timeoutMs ?? 30_000, "embedding 超时", 120_000);
  const fetchImpl = options.fetchImpl ?? fetch;
  let dimensions = options.dimensions;

  const embed = async (texts: readonly string[], signal?: AbortSignal): Promise<number[][]> => {
    if (texts.length === 0) return [];
    const result: number[][] = [];
    for (let start = 0; start < texts.length; start += batchSize) {
      if (signal?.aborted) throw new Error("embedding 请求已取消");
      const batch = texts.slice(start, start + batchSize);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const onAbort = () => controller.abort();
      signal?.addEventListener("abort", onAbort, { once: true });
      try {
        const response = await fetchImpl(`${baseUrl}/embeddings`, {
          method: "POST",
          headers: {
            authorization: `Bearer ${apiKey}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({ model, input: batch }),
          signal: controller.signal,
        });
        if (!response.ok) {
          throw new Error(`embedding 服务返回 HTTP ${response.status}`);
        }
        const payload: unknown = await response.json();
        const parsed = parseEmbeddingResponse(payload, batch.length, dimensions);
        dimensions = parsed.dimensions;
        result.push(...parsed.vectors);
      } catch (error) {
        if (controller.signal.aborted) throw new Error("embedding 请求超时或已取消");
        throw error;
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
      }
    }
    return result;
  };

  return {
    model,
    get dimensions() {
      return dimensions;
    },
    embed,
  };
};

export interface HashEmbeddingOptions {
  /** 特征哈希维度，默认 256 */
  dimensions?: number;
}

const fnv1a = (text: string): number => {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
};

const l2Normalize = (vector: Float64Array): number[] => {
  let squared = 0;
  for (const value of vector) squared += value * value;
  if (squared === 0) return [...vector];
  const length = Math.sqrt(squared);
  return [...vector].map(value => value / length);
};

/**
 * 确定性特征哈希向量：只用于离线 fixture 与测试，不代表语义模型效果。
 * 真实检索质量必须使用 Qwen/GLM embedding 并通过 RAG-05 评测。
 */
export const createHashEmbeddingProvider = (options: HashEmbeddingOptions = {}): EmbeddingProvider => {
  const dimensions = assertPositiveInteger(options.dimensions ?? 256, "哈希 embedding 维度", 4096);
  const embed = async (texts: readonly string[]): Promise<number[][]> => texts.map((text) => {
    const vector = new Float64Array(dimensions);
    for (const token of tokenize(text)) {
      const hash = fnv1a(token);
      const index = hash % dimensions;
      const sign = hash >>> 31 === 1 ? -1 : 1;
      vector[index] = (vector[index] ?? 0) + sign;
    }
    return l2Normalize(vector);
  });
  return { model: "fixture-hash", dimensions, embed };
};

export interface EmbeddingEnvConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  batchSize: number;
  timeoutMs: number;
  dimensions?: number;
}

const parseEnvPositiveInteger = (
  value: string | undefined,
  fallback: number,
  name: string,
  max: number,
): number => {
  if (value === undefined || value.trim() === "") return fallback;
  const parsed = Number(value);
  return assertPositiveInteger(parsed, name, max);
};

/** 默认关闭：RAG_ENABLED 不为 "true" 时返回 null，不读取任何凭证。 */
export const resolveEmbeddingConfig = (
  env: NodeJS.ProcessEnv = process.env,
): EmbeddingEnvConfig | null => {
  if (env.RAG_ENABLED !== "true") return null;
  const baseUrl = env.RAG_EMBEDDING_BASE_URL?.trim();
  const apiKey = env.RAG_EMBEDDING_API_KEY?.trim();
  const model = env.RAG_EMBEDDING_MODEL?.trim();
  if (!baseUrl || !apiKey || !model) {
    throw new Error("RAG embedding 配置不完整：需要 RAG_EMBEDDING_BASE_URL/API_KEY/MODEL");
  }
  const dimensions = env.RAG_EMBEDDING_DIMENSIONS === undefined
    ? undefined
    : parseEnvPositiveInteger(env.RAG_EMBEDDING_DIMENSIONS, 0, "RAG_EMBEDDING_DIMENSIONS", 16_384);
  return {
    baseUrl,
    apiKey,
    model,
    batchSize: parseEnvPositiveInteger(env.RAG_EMBEDDING_BATCH_SIZE, 32, "RAG_EMBEDDING_BATCH_SIZE", 128),
    timeoutMs: parseEnvPositiveInteger(env.RAG_EMBEDDING_TIMEOUT_MS, 30_000, "RAG_EMBEDDING_TIMEOUT_MS", 120_000),
    dimensions,
  };
};
