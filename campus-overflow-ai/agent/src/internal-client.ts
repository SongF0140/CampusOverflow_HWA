// FastAPI 内部白名单接口客户端：仅允许调用 /internal/agent/*（宪法 C-05）
// 鉴权：服务间 token（Authorization: Bearer）；观测：每次调用透传 x-trace-id（C-08）
import { z } from "zod";

import type { ApiResponse, TraceId } from "./types/index.js";

const ResponseEnvelopeSchema = z.object({
  code: z.number(),
  data: z.unknown(),
  message: z.string(),
});

export interface InternalClientConfig {
  baseUrl: string;
  token: string;
  fetchImpl: typeof fetch;
}

export const resolveInternalConfig = (): { baseUrl: string; token: string } => ({
  baseUrl: process.env.BACKEND_BASE_URL ?? "http://localhost:8000",
  // token 缺失时保留空串：T-12 后端会拒绝未带凭证的调用，这里不静默伪造
  token: process.env.AGENT_SERVICE_TOKEN ?? "",
});

export class InternalApiError extends Error {
  readonly status: number;
  readonly code: number;

  constructor(status: number, code: number, message: string) {
    super(`internal api ${status}/${code}: ${message}`);
    this.name = "InternalApiError";
    this.status = status;
    this.code = code;
  }
}

export interface CourseSearchResult {
  id: number;
  name: string;
  code?: string;
}

export interface QuestionSearchResult {
  id: number;
  title: string;
  courseId: number;
  status?: string;
}

export interface InternalClient {
  searchCourses(params: { keyword: string; limit?: number }, traceId: TraceId): Promise<CourseSearchResult[]>;
  searchQuestions(
    params: { keyword: string; courseId?: number; tags?: string[]; limit?: number },
    traceId: TraceId,
  ): Promise<QuestionSearchResult[]>;
}

const buildUrl = (baseUrl: string, path: string, query: Record<string, string | undefined>): string => {
  const url = new URL(path, baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`);
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) {
      url.searchParams.set(key, value);
    }
  }
  return url.toString();
};

export const createInternalClient = (config: InternalClientConfig): InternalClient => {
  const request = async <T>(
    path: string,
    query: Record<string, string | undefined>,
    traceId: TraceId,
  ): Promise<T> => {
    const response = await config.fetchImpl(buildUrl(config.baseUrl, path, query), {
      headers: {
        // 服务间凭证与全链路追踪标识，缺一不可（T-12 验收口径）
        Authorization: `Bearer ${config.token}`,
        "x-trace-id": traceId,
      },
    });
    const raw: unknown = await response.json().catch(() => undefined);
    if (!response.ok) {
      const message = ResponseEnvelopeSchema.safeParse(raw);
      throw new InternalApiError(
        response.status,
        response.status,
        message.success ? message.data.message : `HTTP ${response.status}`,
      );
    }
    const envelope = ResponseEnvelopeSchema.parse(raw);
    return envelope.data as T;
  };

  return {
    searchCourses: (params, traceId) =>
      request("/internal/agent/courses/search", { keyword: params.keyword, limit: params.limit?.toString() }, traceId),
    searchQuestions: (params, traceId) =>
      request(
        "/internal/agent/questions/search",
        {
          keyword: params.keyword,
          courseId: params.courseId?.toString(),
          tags: params.tags?.join(","),
          limit: params.limit?.toString(),
        },
        traceId,
      ),
  };
};

/** 默认实例：读环境变量；测试经 createInternalClient 注入 mock fetch */
export const defaultInternalClient = (): InternalClient =>
  createInternalClient({ ...resolveInternalConfig(), fetchImpl: fetch });
