// FastAPI 内部白名单接口客户端：仅允许调用 /internal/agent/*（宪法 C-05）
// 鉴权：服务间 token 走 X-Service-Token 头（对齐 docs/接口设计指南.md §内部 API，
// 后端 backend/app/modules/governance/router_internal.py 只读 X-Service-Token，
// 用 Authorization: Bearer 会一律 401）；观测：每次调用透传 x-trace-id（C-08）
import { z } from "zod";

import type { ApiResponse, TraceId } from "./types/index.js";

// 成功信封：{ code, data, message }（backend/app/core/response.py ok()）
const ResponseEnvelopeSchema = z.object({
  code: z.number(),
  data: z.unknown(),
  message: z.string(),
});

// 失败信封：后端 core/errors.py 的 _error_response 固定 data=null，
// 错误文案在顶层 message，不能从 data 里取（TS 层面 data 是 unknown，也取不到）
const ErrorEnvelopeSchema = z.object({
  code: z.number(),
  data: z.unknown().nullable().optional(),
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

/** 站内标签词表条目（GET /internal/agent/tags，T-13 补充端点） */
export interface TagVocabularyItem {
  id: number;
  name: string;
  type: string;
}

export interface InternalClient {
  searchCourses(params: { keyword: string; limit?: number }, traceId: TraceId): Promise<CourseSearchResult[]>;
  searchQuestions(
    params: { keyword: string; courseId?: number; tags?: string[]; limit?: number },
    traceId: TraceId,
  ): Promise<QuestionSearchResult[]>;
  fetchTags(params: { limit?: number }, traceId: TraceId): Promise<TagVocabularyItem[]>;
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

/** 列表型端点的 data 信封：后端统一返回 { items, total }（governance/router_internal 模式） */
interface ListEnvelope<T> {
  items: T[];
  total: number;
}

export const createInternalClient = (config: InternalClientConfig): InternalClient => {
  const request = async <T>(
    path: string,
    query: Record<string, string | undefined>,
    traceId: TraceId,
  ): Promise<T> => {
    const response = await config.fetchImpl(buildUrl(config.baseUrl, path, query), {
      headers: {
        // 服务间凭证与全链路追踪标识，缺一不可（T-12 验收口径）
        // 头名必须是 X-Service-Token：后端 require_service_token 只读它
        "X-Service-Token": config.token,
        "x-trace-id": traceId,
      },
    });
    const raw: unknown = await response.json().catch(() => undefined);
    if (!response.ok) {
      const failure = ErrorEnvelopeSchema.safeParse(raw);
      throw new InternalApiError(
        response.status,
        failure.success ? failure.data.code : response.status,
        failure.success ? failure.data.message : `HTTP ${response.status}`,
      );
    }
    const envelope = ResponseEnvelopeSchema.parse(raw);
    return envelope.data as T;
  };

  return {
    searchCourses: async (params, traceId) => {
      const data = await request<ListEnvelope<CourseSearchResult>>(
        "/internal/agent/courses/search",
        { keyword: params.keyword, limit: params.limit?.toString() },
        traceId,
      );
      return data.items;
    },
    searchQuestions: async (params, traceId) => {
      const data = await request<ListEnvelope<QuestionSearchResult>>(
        "/internal/agent/questions/search",
        {
          keyword: params.keyword,
          courseId: params.courseId?.toString(),
          tags: params.tags?.join(","),
          limit: params.limit?.toString(),
        },
        traceId,
      );
      return data.items;
    },
    fetchTags: async (params, traceId) => {
      const data = await request<ListEnvelope<TagVocabularyItem>>(
        "/internal/agent/tags",
        { limit: params.limit?.toString() },
        traceId,
      );
      return data.items;
    },
  };
};

/** 默认实例：读环境变量；测试经 createInternalClient 注入 mock fetch */
export const defaultInternalClient = (): InternalClient =>
  createInternalClient({ ...resolveInternalConfig(), fetchImpl: fetch });
