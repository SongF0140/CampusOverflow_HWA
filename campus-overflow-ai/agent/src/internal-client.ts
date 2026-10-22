// FastAPI 内部白名单接口客户端：仅允许调用 /internal/agent/*（宪法 C-05）
// 用户运行同时携带服务 token 和用户 Bearer，检索只走双凭证 user 路径；旧服务客户端保留。
import { z } from "zod";

import { AgentPrincipalSchema, type AgentPrincipal } from "./auth/principal.js";
import type { TraceId } from "./types/index.js";

// 成功信封：{ code, data, message }（backend/app/core/response.py ok()）
const ResponseEnvelopeSchema = z.object({
  code: z.literal(200),
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
  authorization?: string;
  signal?: AbortSignal;
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

/** 治理目标正文（GET /internal/agent/user/moderation-targets/{type}/{id}，G-03 补充端点） */
export interface ModerationContentResult {
  targetType: "question" | "answer" | "comment";
  targetId: number;
  authorId: number;
  courseId?: number;
  title?: string;
  body: string;
}

export interface InternalClient {
  searchCourses(params: { keyword: string; limit?: number }, traceId: TraceId): Promise<CourseSearchResult[]>;
  searchQuestions(
    params: { keyword: string; courseId?: number; tags?: string[]; limit?: number },
    traceId: TraceId,
  ): Promise<QuestionSearchResult[]>;
  fetchTags(params: { limit?: number }, traceId: TraceId): Promise<TagVocabularyItem[]>;
  fetchModerationTarget(
    params: { targetType: "question" | "answer" | "comment"; targetId: number },
    traceId: TraceId,
  ): Promise<ModerationContentResult>;
}

export interface UserInternalClient extends InternalClient {
  resolvePrincipal(traceId: TraceId): Promise<AgentPrincipal>;
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
const listSchema = <T>(item: z.ZodType<T>) => z.object({
  items: z.array(item), total: z.number().int().nonnegative(),
});
const CourseListSchema = listSchema(z.object({
  id: z.number().int().positive(), name: z.string(), code: z.string().optional(),
}));
const QuestionListSchema = listSchema(z.object({
  id: z.number().int().positive(), title: z.string(), course_id: z.number().int().positive(),
  status: z.string().optional(),
}));
const TagListSchema = listSchema(z.object({
  id: z.number().int().positive(), name: z.string(), type: z.string(),
}));
const ModerationContentSchema = z.object({
  target_type: z.enum(["question", "answer", "comment"]),
  target_id: z.number().int().positive(),
  author_id: z.number().int().positive(),
  course_id: z.number().int().positive().nullable(),
  title: z.string().nullable(),
  body: z.string(),
});

const createRequest = (config: InternalClientConfig) => {
  return async <T>(
    path: string,
    query: Record<string, string | undefined>,
    traceId: TraceId,
    schema: z.ZodType<T>,
  ): Promise<T> => {
    const headers = new Headers({ "X-Service-Token": config.token, "x-trace-id": traceId });
    if (config.authorization !== undefined) headers.set("authorization", config.authorization);
    const response = await config.fetchImpl(buildUrl(config.baseUrl, path, query), {
      headers,
      signal: config.signal
        ? AbortSignal.any([config.signal, AbortSignal.timeout(60_000)])
        : AbortSignal.timeout(60_000),
      redirect: "error",
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
    const envelope = ResponseEnvelopeSchema.safeParse(raw);
    const parsed = envelope.success ? schema.safeParse(envelope.data.data) : undefined;
    if (!parsed?.success) throw new InternalApiError(502, 502, "内部接口响应格式无效");
    return parsed.data;
  };
};

export const createInternalClient = (config: InternalClientConfig): UserInternalClient => {
  // 即使传空凭证也不退回服务检索，由后端拒绝无效用户身份。
  const prefix = config.authorization === undefined ? "/internal/agent" : "/internal/agent/user";
  const request = createRequest(config);
  return {
    resolvePrincipal: async (traceId) =>
      request("/internal/agent/principal", {}, traceId, AgentPrincipalSchema),
    searchCourses: async (params, traceId) => {
      const data = await request(
        `${prefix}/courses/search`,
        { keyword: params.keyword, limit: params.limit?.toString() },
        traceId, CourseListSchema,
      );
      return data.items;
    },
    searchQuestions: async (params, traceId) => {
      const data = await request(
        `${prefix}/questions/search`,
        {
          keyword: params.keyword,
          course_id: params.courseId?.toString(),
          tags: params.tags?.join(","),
          limit: params.limit?.toString(),
        },
        traceId, QuestionListSchema,
      );
      return data.items.map((item) => ({ id: item.id, title: item.title, courseId: item.course_id, status: item.status }));
    },
    fetchTags: async (params, traceId) => {
      const data = await request(
        `${prefix}/tags`,
        { limit: params.limit?.toString() },
        traceId, TagListSchema,
      );
      return data.items;
    },
    fetchModerationTarget: async (params, traceId) => {
      const data = await request(
        `${prefix}/moderation-targets/${params.targetType}/${params.targetId}`,
        {},
        traceId, ModerationContentSchema,
      );
      if (data.target_type !== params.targetType || data.target_id !== params.targetId) {
        throw new InternalApiError(502, 502, "正文响应目标与请求不匹配");
      }
      return {
        targetType: data.target_type,
        targetId: data.target_id,
        authorId: data.author_id,
        courseId: data.course_id ?? undefined,
        title: data.title ?? undefined,
        body: data.body,
      };
    },
  };
};

/** 默认实例：读环境变量；测试经 createInternalClient 注入 mock fetch */
export const defaultInternalClient = (authorization: string, signal?: AbortSignal): UserInternalClient =>
  createInternalClient({ ...resolveInternalConfig(), authorization, signal, fetchImpl: fetch });
