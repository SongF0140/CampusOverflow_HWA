// FastAPI 内部白名单接口客户端：仅允许调用 /internal/agent/*（宪法 C-05）
// 用户运行同时携带服务 token 和用户 Bearer，检索只走双凭证 user 路径；旧服务客户端保留。
import { z } from "zod";

import { AgentPrincipalSchema, type AgentPrincipal } from "./auth/principal.js";
import {
  GovernanceRequestAckSchema, GovernanceRequestInputSchema, GovernanceStateSchema, GovernanceTargetSchema,
  type GovernanceRequestAck, type GovernanceRequestInput, type GovernanceState,
} from "./approvals/types.js";
import { createAuditClient, type AuditClient } from "./observability/audit-client.js";
import { checkSignal, withUpstreamDeadline } from "./loop/abort.js";
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

/** 课程知识树节点（GET /internal/agent/[user/]courses/{id}/knowledge-tree，K-02 补充端点） */
export interface KnowledgeTreeNodeItem {
  id: number;
  name: string;
}

/** 近期问题正文（GET /internal/agent/courses/{id}/questions/recent，K-02 补充端点） */
export interface RecentQuestionItem {
  id: number;
  title: string;
  body: string;
  created_at: string;
  tags?: Array<{ id: number; name: string; type?: string }>;
}

/** 有知识树的课程条目（GET /internal/agent/knowledge-tree/courses，K-02 补充端点） */
export interface KnowledgeTreeCourseEntry {
  course_id: number;
  teacher_id: number;
}

/** 周报保存请求体（POST /internal/agent/reports，K-02 补充端点；蛇形） */
export interface WeeklyReportSaveBody {
  course_id: number;
  week_start: string;
  week_end: string;
  content: string;
  uncovered_topics: Array<{ topic: string; question_count: number; suggestion: string }>;
  heatmap: Array<{ node_id: number; node_name: string; question_count: number }>;
  question_count: number;
  agent_run_id: string;
}

/** 巡检内容条目（GET /internal/agent/patrol/contents，T-15-B 补充端点） */
export interface PatrolContentItem {
  target_type: "question" | "answer" | "comment";
  target_id: number;
  body: string;
  author_id: number;
  course_id: number | null;
}

/** 巡检建单请求体（POST /internal/agent/patrol/cases，T-15-B 补充端点；蛇形） */
export interface PatrolCaseBody {
  target_type: "question" | "answer" | "comment";
  target_id: number;
  risk_level: "low" | "medium" | "high";
  reason: string;
  snapshot: string;
  agent_run_id: string;
}

/** 巡检建单响应：data.repeat=true 表示同目标已有未结案工单（幂等跳过） */
export interface PatrolCaseAck {
  repeat: boolean;
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
  fetchKnowledgeTree(
    params: { courseId: number },
    traceId: TraceId,
  ): Promise<KnowledgeTreeNodeItem[]>;
  fetchKnowledgeTreeCourses(traceId: TraceId): Promise<KnowledgeTreeCourseEntry[]>;
  fetchRecentQuestions(
    params: { courseId: number; days?: number; limit?: number },
    traceId: TraceId,
  ): Promise<RecentQuestionItem[]>;
  saveWeeklyReport(body: WeeklyReportSaveBody, traceId: TraceId): Promise<{ id: number }>;
  fetchPatrolContents(
    params: { hours?: number; limit?: number },
    traceId: TraceId,
  ): Promise<PatrolContentItem[]>;
  createPatrolCase(body: PatrolCaseBody, traceId: TraceId): Promise<PatrolCaseAck>;
}

export interface UserInternalClient extends InternalClient {
  audit: AuditClient;
  resolvePrincipal(traceId: TraceId): Promise<AgentPrincipal>;
  fetchGovernanceTargetState(
    params: { targetType: "question" | "answer" | "comment" | "user"; targetId: number; includeVersion?: boolean },
    traceId: TraceId,
  ): Promise<GovernanceState>;
  createGovernanceRequest(body: GovernanceRequestInput, traceId: TraceId): Promise<GovernanceRequestAck>;
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
const KnowledgeTreeSchema = z.object({
  course_id: z.number().int().positive(),
  nodes: z.array(z.object({ id: z.number().int().positive(), name: z.string() })),
});
const KnowledgeTreeCoursesSchema = z.object({
  items: z.array(z.object({
    course_id: z.number().int().positive(),
    teacher_id: z.number().int().positive(),
  })),
  total: z.number().int().nonnegative(),
});
const RecentQuestionsSchema = z.object({
  items: z.array(z.object({
    id: z.number().int().positive(),
    title: z.string(),
    body: z.string(),
    created_at: z.string(),
    tags: z.array(z.object({ id: z.number().int().positive(), name: z.string().min(1).max(50), type: z.string().optional() })).default([]),
  })),
  total: z.number().int().nonnegative(),
});
const ReportSaveAck = z.object({ id: z.number().int().positive() });
const PatrolContentsSchema = z.object({
  items: z.array(z.object({
    target_type: z.enum(["question", "answer", "comment"]),
    target_id: z.number().int().positive(),
    body: z.string(),
    author_id: z.number().int().positive(),
    course_id: z.number().int().positive().nullable(),
  })),
  total: z.number().int().nonnegative(),
});
const PatrolCaseAckSchema = z.object({ repeat: z.boolean() });

const createRequest = (config: InternalClientConfig) => {
  return async <T>(
    path: string,
    query: Record<string, string | undefined>,
    traceId: TraceId,
    schema: z.ZodType<T>,
    write?: { method: "POST" | "PATCH"; body: unknown; signal?: AbortSignal },
  ): Promise<T> => {
    const headers = new Headers({ "X-Service-Token": config.token, "x-trace-id": traceId });
    if (config.authorization !== undefined) headers.set("authorization", config.authorization);
    if (write) headers.set("content-type", "application/json");
    return withUpstreamDeadline(write?.signal ?? config.signal, async (signal) => {
      const response = await config.fetchImpl(buildUrl(config.baseUrl, path, query), {
        headers,
        ...(write ? { method: write.method, body: JSON.stringify(write.body) } : {}),
        signal,
        redirect: "error",
      });
      checkSignal(signal);
      const raw: unknown = await response.json().catch(() => undefined);
      checkSignal(signal);
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
    });
  };
};

export const createInternalClient = (config: InternalClientConfig): UserInternalClient => {
  // 即使传空凭证也不退回服务检索，由后端拒绝无效用户身份。
  const prefix = config.authorization === undefined ? "/internal/agent" : "/internal/agent/user";
  const request = createRequest(config);
  return {
    audit: createAuditClient(
      (path, trace, schema, method, body, signal) => request(path, {}, trace, schema, { method, body, signal }),
      config.authorization === undefined ? "/internal/agent" : "/internal/agent/user",
    ),
    resolvePrincipal: async (traceId) =>
      request("/internal/agent/principal", {}, traceId, AgentPrincipalSchema),
    fetchGovernanceTargetState: async (params, traceId) => {
      if (config.authorization === undefined) throw new InternalApiError(401, 401, "需要用户登录凭证");
      const target = GovernanceTargetSchema.parse(params);
      const data = await request(
        `/internal/agent/user/governance-targets/${target.targetType}/${target.targetId}/state`,
        params.includeVersion ? { include_version: "true" } : {}, traceId, GovernanceStateSchema,
      );
      if (data.target_type !== target.targetType || data.target_id !== target.targetId) {
        throw new InternalApiError(502, 502, "治理状态响应目标与请求不匹配");
      }
      if (params.includeVersion && data.state_version === undefined) {
        throw new InternalApiError(502, 502, "治理预览缺少状态版本");
      }
      return data;
    },
    createGovernanceRequest: async (body, traceId) => {
      if (config.authorization === undefined) throw new InternalApiError(401, 401, "需要用户登录凭证");
      const parsed = GovernanceRequestInputSchema.parse(body);
      const days = parsed.action === "ban_temp" ? parsed.duration_days ?? 7 : undefined;
      const data = await request(
        "/internal/agent/user/governance-requests", {}, traceId, GovernanceRequestAckSchema,
        { method: "POST", body: { ...parsed, ...(days === undefined ? {} : { duration_days: days }) } },
      );
      if (data.request_id !== parsed.request_id || data.agent_run_id !== `approval-${parsed.request_id}`
        || data.target_type !== parsed.target_type || data.target_id !== parsed.target_id
        || data.action !== parsed.action || (data.duration_days ?? undefined) !== days) {
        throw new InternalApiError(502, 502, "审批申请响应与请求不匹配");
      }
      return data;
    },
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
    fetchKnowledgeTree: async (params, traceId) => {
      const data = await request(
        `${prefix}/courses/${params.courseId}/knowledge-tree`,
        {},
        traceId, KnowledgeTreeSchema,
      );
      return data.nodes.map((node) => ({ id: node.id, name: node.name }));
    },
    fetchKnowledgeTreeCourses: async (traceId) => {
      const data = await request(
        "/internal/agent/knowledge-tree/courses",
        {},
        traceId, KnowledgeTreeCoursesSchema,
      );
      return data.items;
    },
    fetchRecentQuestions: async (params, traceId) => {
      const data = await request(
        `${prefix}/courses/${params.courseId}/questions/recent`,
        { days: params.days?.toString(), limit: params.limit?.toString() },
        traceId, RecentQuestionsSchema,
      );
      return data.items;
    },
    saveWeeklyReport: async (body, traceId) =>
      request("/internal/agent/reports", {}, traceId, ReportSaveAck, { method: "POST", body }),
    fetchPatrolContents: async (params, traceId) => {
      const data = await request(
        "/internal/agent/patrol/contents",
        { hours: params.hours?.toString(), limit: params.limit?.toString() },
        traceId, PatrolContentsSchema,
      );
      return data.items;
    },
    createPatrolCase: async (body, traceId) =>
      request("/internal/agent/patrol/cases", {}, traceId, PatrolCaseAckSchema, {
        method: "POST", body,
      }),
  };
};

/** 默认实例：读环境变量；测试经 createInternalClient 注入 mock fetch */
export const defaultInternalClient = (authorization: string, signal?: AbortSignal): UserInternalClient =>
  createInternalClient({ ...resolveInternalConfig(), authorization, signal, fetchImpl: fetch });
