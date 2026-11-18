// FastAPI 内部白名单接口客户端：仅允许调用 /internal/agent/*（宪法 C-05）
// 用户运行同时携带服务 token 和用户 Bearer，检索只走双凭证 user 路径；旧服务客户端保留。
import { z } from "zod";
import { GovernanceV2Schema } from "./approvals/v2.js";
import { ServerMemorySchema, ServerSessionSchema, ServerSessionInputSchema, type PrivateContextsClient } from "./memory/server-context.js";
import { LearningFeedbackSchema, type LearningFeedback } from "./scheduler/learning-feedback.js";
import type { TrustedKnowledgeTag } from "./knowledge/types.js";
import { PublishedExperienceSchema } from "./memory/main-context.js";

import { AgentPrincipalSchema, type AgentPrincipal } from "./auth/principal.js";
import {
  GovernanceRequestAckSchema, GovernanceRequestInputSchema, GovernanceStateSchema, GovernanceTargetSchema,
  ApprovalWaitSchema, type ApprovalWait,
  ClassChangeInputSchema, ClassChangeResultSchema, type ClassChangeInput, type ClassChangeResult,
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
  externalKey?: string;
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

export type PatrolScanTargetType = "question" | "answer" | "comment";
export type PatrolScanStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";

/** 管理员全量扫描任务（P2）：只含进度与计数，不含正文 */
export interface PatrolScanJob {
  id: number;
  status: PatrolScanStatus;
  target_types: PatrolScanTargetType[];
  cursor_type: PatrolScanTargetType | null;
  cursor_id: number | null;
  scanned: number;
  escalated: number;
  skipped: number;
  failed: number;
  cancel_requested: boolean;
  created_by: number | null;
  trace_id: string;
  error_summary: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
}

export interface PatrolScanPage {
  job: PatrolScanJob;
  items: PatrolContentItem[];
  has_more: boolean;
}

/** 离线整理输入：工单判定与最终处置摘要（不含内容快照与隐私原文） */
export interface PatrolFeedbackItem {
  case_id: number;
  target_type: string;
  target_id: number;
  risk_level: string;
  source: string;
  status: string;
  resolution: string | null;
  decision_source: string | null;
  reason: string;
  agent_run_id: string | null;
  trace_id: string | null;
  created_at: string;
  resolved_at: string | null;
}

/** 离线整理笔记（POST /internal/agent/patrol/notes；蛇形，单批最多 5 条） */
export interface PatrolNoteInput {
  note_key: string;
  note_type: "false_positive" | "missed_case" | "rule_degradation" | "gap" | "focus";
  source_case_id?: number | null;
  target_type?: string | null;
  target_id?: number | null;
  rule_version: string;
  model_version: string;
  summary: string;
  confidence: number;
  evidence_count?: number;
  valid_until: string;
}

export interface PatrolNotesAck {
  total: number;
  repeated: number;
  repeat: boolean;
}

/** N-3 注入候选：active、未过期、置信度达标的笔记 */
export interface PatrolNoteItem {
  id: number;
  note_key: string;
  note_type: string;
  source_case_id: number | null;
  target_type: string | null;
  target_id: number | null;
  rule_version: string;
  model_version: string;
  summary: string;
  confidence: number;
  evidence_count: number;
  valid_until: string;
  status: string;
  created_at: string;
}

export interface InjectedPatrolNotes {
  items: PatrolNoteItem[];
  truncated: boolean;
  max_chars: number;
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
  createPatrolScan(
    params: { targetTypes?: PatrolScanTargetType[]; createdBy?: number },
    traceId: TraceId,
  ): Promise<PatrolScanJob>;
  getPatrolScan(jobId: number, traceId: TraceId): Promise<PatrolScanJob>;
  cancelPatrolScan(jobId: number, traceId: TraceId): Promise<PatrolScanJob>;
  updatePatrolScanProgress(
    jobId: number,
    body: {
      cursorType?: PatrolScanTargetType | null;
      cursorId?: number | null;
      scannedDelta?: number;
      escalatedDelta?: number;
      skippedDelta?: number;
      failedDelta?: number;
      status?: "running" | "succeeded" | "failed";
      errorSummary?: string | null;
    },
    traceId: TraceId,
  ): Promise<PatrolScanJob>;
  fetchPatrolScanPage(
    params: { jobId: number; limit?: number },
    traceId: TraceId,
  ): Promise<PatrolScanPage>;
  fetchPatrolFeedback(
    params: { days?: number; limit?: number },
    traceId: TraceId,
  ): Promise<PatrolFeedbackItem[]>;
  createPatrolNotes(
    body: { notes: PatrolNoteInput[] },
    traceId: TraceId,
    agentRunId?: string,
  ): Promise<PatrolNotesAck>;
  expirePatrolNotes(traceId: TraceId): Promise<{ expired: number }>;
  fetchQaIndexSnapshot(
    params: { cursor?: number; limit?: number },
    traceId: TraceId,
  ): Promise<{ items: QaIndexItem[]; next_cursor: number | null }>;
  fetchQaCandidates(
    params: { ids: number[]; courseId?: number },
    traceId: TraceId,
  ): Promise<QaIndexItem[]>;
  fetchInjectedPatrolNotes(
    params: { maxChars?: number; minConfidence?: number; limit?: number },
    traceId: TraceId,
  ): Promise<InjectedPatrolNotes>;
  fetchLearningFeedback?(params: { courseId: number; days?: number }, traceId: TraceId): Promise<LearningFeedback>;
}

export interface UserInternalClient extends InternalClient {
  privateContexts?: PrivateContextsClient;
  audit: AuditClient;
  resolvePrincipal(traceId: TraceId): Promise<AgentPrincipal>;
  fetchGovernanceTargetState(
    params: { targetType: "question" | "answer" | "comment" | "user"; targetId: number; includeVersion?: boolean },
    traceId: TraceId,
  ): Promise<GovernanceState>;
  createGovernanceRequest(body: GovernanceRequestInput, traceId: TraceId): Promise<GovernanceRequestAck>;
  readApprovalWait(requestId: string, operation: "read" | "resume" | "cancel", traceId: TraceId): Promise<ApprovalWait>;
  fetchCatalogTags(traceId: TraceId): Promise<TrustedKnowledgeTag[]>;
  fetchTrustedTags(courseId: number, traceId: TraceId): Promise<Array<TrustedKnowledgeTag & { tag_id: number; name: string }>>;
  recordLearningEvent(body: { event_id: string; course_id: number; tag_ids: number[]; knowledge_node_ids?: number[]; question_id?: number }, traceId: TraceId): Promise<{ event_id: string; repeat: boolean }>;
  fetchPublishedExperiences(courseId: number, traceId: TraceId): Promise<z.infer<typeof PublishedExperienceSchema>[]>;
  submitExperienceProposal(body: unknown, traceId: TraceId): Promise<{ id: number; status: string }>;
  verifyCertifiedAnswer(answerId: number, traceId: TraceId): Promise<{ certified: boolean; visible: boolean; course_id: number; question_id: number; answer_id: number; url: string }>;
  proposeClassChange(body: ClassChangeInput, traceId: TraceId): Promise<ClassChangeResult>;
  readClassChange(requestId: string, traceId: TraceId): Promise<ClassChangeResult>;
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
const PatrolScanJobSchema = z.object({
  id: z.number().int().positive(),
  status: z.enum(["queued", "running", "succeeded", "failed", "cancelled"]),
  target_types: z.array(z.enum(["question", "answer", "comment"])).min(1).max(3),
  cursor_type: z.enum(["question", "answer", "comment"]).nullable(),
  cursor_id: z.number().int().positive().nullable(),
  scanned: z.number().int().nonnegative(),
  escalated: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  cancel_requested: z.boolean(),
  created_by: z.number().int().positive().nullable(),
  trace_id: z.string(),
  error_summary: z.string().nullable(),
  created_at: z.string(),
  started_at: z.string().nullable(),
  finished_at: z.string().nullable(),
});
const PatrolScanPageSchema = z.object({
  job: PatrolScanJobSchema,
  items: PatrolContentsSchema.shape.items,
  has_more: z.boolean(),
});
const PatrolFeedbackSchema = z.object({
  items: z.array(z.object({
    case_id: z.number().int().positive(),
    target_type: z.string(),
    target_id: z.number().int(),
    risk_level: z.string(),
    source: z.string(),
    status: z.string(),
    resolution: z.string().nullable(),
    decision_source: z.string().nullable(),
    reason: z.string(),
    agent_run_id: z.string().nullable(),
    trace_id: z.string().nullable(),
    created_at: z.string(),
    resolved_at: z.string().nullable(),
  })),
  total: z.number().int().nonnegative(),
});
const PatrolNotesAckSchema = z.object({
  total: z.number().int().nonnegative(),
  repeated: z.number().int().nonnegative(),
  repeat: z.boolean(),
});
const PatrolExpireAckSchema = z.object({ expired: z.number().int().nonnegative() });

/** 问答索引导出条目：只有检索必要字段，不含正文与作者 */
export interface QaIndexItem {
  id: number;
  title: string;
  course_id: number;
  status: string;
  tag_ids: number[];
  updated_at: string;
}

const QaIndexItemSchema = z.object({
  id: z.number().int().positive(),
  title: z.string(),
  course_id: z.number().int().positive(),
  status: z.string(),
  tag_ids: z.array(z.number().int().positive()),
  updated_at: z.string(),
});

const QaIndexPageSchema = z.object({
  items: z.array(QaIndexItemSchema),
  next_cursor: z.number().int().nonnegative().nullable(),
});

/** 候选复核响应：只含后端裁决为可见的问题，total 为复核后条数 */
const QaCandidatesSchema = z.object({
  items: z.array(QaIndexItemSchema),
  total: z.number().int().nonnegative(),
});
const InjectedPatrolNotesSchema = z.object({
  items: z.array(z.object({
    id: z.number().int().positive(),
    note_key: z.string(),
    note_type: z.string(),
    source_case_id: z.number().int().nullable(),
    target_type: z.string().nullable(),
    target_id: z.number().int().nullable(),
    rule_version: z.string(),
    model_version: z.string(),
    summary: z.string(),
    confidence: z.number().int(),
    evidence_count: z.number().int().nonnegative(),
    valid_until: z.string(),
    status: z.string(),
    created_at: z.string(),
  })),
  truncated: z.boolean(),
  max_chars: z.number().int(),
});

const createRequest = (config: InternalClientConfig) => {
  return async <T>(
    path: string,
    query: Record<string, string | undefined>,
    traceId: TraceId,
    schema: z.ZodType<T>,
    write?: { method: "POST" | "PATCH" | "PUT" | "DELETE"; body: unknown; signal?: AbortSignal; version?: number },
  ): Promise<T> => {
    const headers = new Headers({ "X-Service-Token": config.token, "x-trace-id": traceId });
    if (config.authorization !== undefined) headers.set("authorization", config.authorization);
    if (config.externalKey !== undefined) headers.set("x-external-agent-key", config.externalKey);
    if (write) headers.set("content-type", "application/json");
    if (write?.version !== undefined) headers.set("If-Match", String(write.version));
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
    privateContexts: {
      memory: trace => request("/internal/agent/user/private-context/memory", {}, trace, ServerMemorySchema),
      sessions: trace => request("/internal/agent/user/private-context/sessions", {}, trace, z.array(ServerSessionSchema).max(20)),
      session: async (id, trace) => {
        const key = z.uuid().parse(id).toLowerCase();
        const data = await request(`/internal/agent/user/private-context/sessions/${key}`, {}, trace, ServerSessionSchema);
        if (data.id !== key) throw new InternalApiError(502, 502, "私人会话标识不匹配");
        return data;
      },
      create: (input, trace) => request("/internal/agent/user/private-context/sessions", {}, trace, ServerSessionSchema,
        { method: "POST", body: ServerSessionInputSchema.parse(input) }),
      save: async (id, input, trace) => {
        const key = z.uuid().parse(id).toLowerCase();
        const body = ServerSessionInputSchema.extend({ version: z.number().int().positive() }).parse(input);
        const data = await request(`/internal/agent/user/private-context/sessions/${key}`, {}, trace, ServerSessionSchema,
          { method: "PUT", body });
        if (data.id !== key) throw new InternalApiError(502, 502, "私人会话标识不匹配");
        return data;
      },
      remove: (id, version, trace) => request(`/internal/agent/user/private-context/sessions/${z.uuid().parse(id)}`, {}, trace, ServerSessionSchema,
        { method: "DELETE", body: {}, version: z.number().int().positive().parse(version) }),
    },
    audit: createAuditClient(
      (path, trace, schema, method, body, signal) => request(path, {}, trace, schema, { method, body, signal }),
      config.authorization === undefined ? "/internal/agent" : "/internal/agent/user",
    ),
    resolvePrincipal: async (traceId) =>
      request(config.externalKey ? "/internal/agent/external/principal" : "/internal/agent/principal", {}, traceId, AgentPrincipalSchema),
    fetchCatalogTags: async trace => (await request("/internal/agent/knowledge-catalog/tags", {}, trace,
      z.object({ items: z.array(z.object({ id: z.number().int().positive(), course_id: z.number().int().positive(), source: z.enum(["teacher", "textbook"]), active: z.boolean() })) }))).items,
    proposeClassChange: async (body, trace) => {
      const parsed = ClassChangeInputSchema.parse(body);
      const data = await request("/internal/agent/user/class-changes", {}, trace, ClassChangeResultSchema, { method: "POST", body: parsed });
      if (data.request_id !== parsed.request_id || data.course_id !== parsed.course_id || data.action !== parsed.action
        || JSON.stringify(data.students.map(item => item.user_id).sort((a, b) => a - b)) !== JSON.stringify([...parsed.student_ids].sort((a, b) => a - b))) {
        throw new InternalApiError(502, 502, "名单申请响应与请求不一致");
      }
      return data;
    },
    readClassChange: async (requestId, trace) => {
      const id = z.uuid().parse(requestId).toLowerCase();
      const data = await request(`/internal/agent/user/class-changes/${id}`, {}, trace, ClassChangeResultSchema);
      if (data.request_id !== id) throw new InternalApiError(502, 502, "名单申请标识不一致");
      return data;
    },
    fetchTrustedTags: async (courseId, trace) => {
      const id = z.number().int().positive().parse(courseId);
      const data = await request(`/internal/agent/user/courses/${id}/trusted-tags`, {}, trace,
        z.array(z.object({ id: z.number().int().positive(), tag_id: z.number().int().positive(), name: z.string(),
          course_id: z.number().int().positive(), source: z.enum(["teacher", "textbook"]), active: z.boolean() })).max(500));
      if (data.some(tag => tag.course_id !== id || tag.id !== tag.tag_id || !tag.active)) {
        throw new InternalApiError(502, 502, "可信词表响应与课程不一致");
      }
      return data;
    },
    fetchLearningFeedback: async (params, trace) => request(`/internal/agent/learning-feedback/${z.number().int().positive().parse(params.courseId)}`,
      { days: params.days?.toString() }, trace, LearningFeedbackSchema),
    recordLearningEvent: async (body, trace) => request("/internal/agent/user/learning-events", {}, trace,
      z.object({ event_id: z.uuid(), repeat: z.boolean() }), { method: "POST", body }),
    fetchPublishedExperiences: async (courseId, trace) => {
      const id = z.number().int().positive().parse(courseId);
      const data = await request(`/internal/agent/user/courses/${id}/experiences`, {}, trace, z.array(PublishedExperienceSchema).max(100));
      if (data.some(item => item.course_id !== id)) throw new InternalApiError(502, 502, "经验响应课程不一致");
      return data;
    },
    submitExperienceProposal: async (body, trace) => request("/internal/agent/user/experience-proposals", {}, trace,
      z.object({ id: z.number().int().positive(), status: z.string() }), { method: "POST", body }),
    verifyCertifiedAnswer: async (answerId, trace) => {
      const id = z.number().int().positive().parse(answerId);
      const data = await request(`/internal/agent/user/certified-answers/${id}`, {}, trace,
        z.object({ certified: z.boolean(), visible: z.boolean(), course_id: z.number().int().positive(),
          question_id: z.number().int().positive(), answer_id: z.number().int().positive(), url: z.string() }));
      if (data.answer_id !== id || data.url !== `/questions/${data.question_id}#answer-${id}`) {
        throw new InternalApiError(502, 502, "认证答案回显不一致");
      }
      return data;
    },
    fetchGovernanceTargetState: async (params, traceId) => {
      if (config.authorization === undefined && !config.externalKey) throw new InternalApiError(401, 401, "需要用户登录凭证");
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
    readApprovalWait: async (requestId, operation, traceId) => {
      if (config.authorization === undefined && !config.externalKey) throw new InternalApiError(401, 401, "需要用户登录凭证");
      const id = z.uuid().parse(requestId).toLowerCase();
      const op = z.enum(["read", "resume", "cancel"]).parse(operation);
      let data;
      try {
        data = await request(`/internal/agent/user/governance-requests/${id}${op === "read" ? "" : `/${op}`}`,
          {}, traceId, ApprovalWaitSchema, op === "read" ? undefined : { method: "POST", body: {} });
      } catch (error) {
        if (!(error instanceof InternalApiError) || error.status !== 404) throw error;
        const v2 = await request(`/internal/agent/user/governance-requests/v2/${id}`, {}, traceId, GovernanceV2Schema);
        if (v2.request_id !== id) throw new InternalApiError(502, 502, "v2申请标识不匹配");
        if (op === "cancel") throw new InternalApiError(409, 409, "请在管理员审批中心取消v2申请");
        const waiting = v2.status === "pending" || v2.status === "approved";
        const caseStatus = v2.executed ? "executed" : waiting ? "pending" : "rejected";
        data = ApprovalWaitSchema.parse({ request_id: id, case_id: v2.case_id, contract_version: 2,
          approval_status: v2.status, execution_state: v2.execution_state,
          state: v2.executed ? "completed" : waiting ? "waiting" : v2.status === "expired" ? "expired" : "rejected",
          case_status: caseStatus, executed: v2.executed, expires_at: v2.expires_at,
          result: waiting ? null : { case_status: caseStatus, resolution: v2.executed ? v2.frozen_call.action : null, executed: v2.executed },
          agent_run_id: v2.agent_run_id, trace_id: v2.trace_id });
      }
      if (data.request_id !== id || data.agent_run_id !== `approval-${id}`) {
        throw new InternalApiError(502, 502, "审批续接响应与请求不一致");
      }
      return data;
    },
    createGovernanceRequest: async (body, traceId) => {
      if (config.authorization === undefined && !config.externalKey) throw new InternalApiError(401, 401, "需要用户登录凭证");
      const parsed = GovernanceRequestInputSchema.parse(body);
      const days = parsed.action === "ban_temp" ? parsed.duration_days ?? 7 : undefined;
      if (process.env.GOVERNANCE_EXECUTOR_ENABLED === "true") {
        const v2 = await request("/internal/agent/user/governance-requests/v2", {}, traceId, GovernanceV2Schema,
          { method: "POST", body: { ...parsed, ...(days === undefined ? {} : { duration_days: days }) } });
        if (v2.request_id !== parsed.request_id || v2.frozen_call.target_type !== parsed.target_type
          || v2.frozen_call.target_id !== parsed.target_id || v2.frozen_call.action !== parsed.action
          || v2.frozen_call.expected_version !== parsed.expected_version) throw new InternalApiError(502, 502, "v2冻结申请不匹配");
        return GovernanceRequestAckSchema.parse({ ...v2, ...v2.frozen_call, contract_version: 2, repeat: false });
      }
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
    createPatrolScan: async (params, traceId) =>
      request("/internal/agent/patrol/scans", {}, traceId, PatrolScanJobSchema, {
        method: "POST",
        body: {
          ...(params.targetTypes === undefined ? {} : { target_types: params.targetTypes }),
          ...(params.createdBy === undefined ? {} : { created_by: params.createdBy }),
        },
      }),
    getPatrolScan: async (jobId, traceId) =>
      request(
        `/internal/agent/patrol/scans/${z.number().int().positive().parse(jobId)}`,
        {}, traceId, PatrolScanJobSchema,
      ),
    cancelPatrolScan: async (jobId, traceId) =>
      request(
        `/internal/agent/patrol/scans/${z.number().int().positive().parse(jobId)}/cancel`,
        {}, traceId, PatrolScanJobSchema, { method: "POST", body: {} },
      ),
    updatePatrolScanProgress: async (jobId, body, traceId) =>
      request(
        `/internal/agent/patrol/scans/${z.number().int().positive().parse(jobId)}/progress`,
        {}, traceId, PatrolScanJobSchema,
        {
          method: "PATCH",
          body: {
            ...(body.cursorType === undefined ? {} : { cursor_type: body.cursorType }),
            ...(body.cursorId === undefined ? {} : { cursor_id: body.cursorId }),
            ...(body.scannedDelta === undefined ? {} : { scanned_delta: body.scannedDelta }),
            ...(body.escalatedDelta === undefined ? {} : { escalated_delta: body.escalatedDelta }),
            ...(body.skippedDelta === undefined ? {} : { skipped_delta: body.skippedDelta }),
            ...(body.failedDelta === undefined ? {} : { failed_delta: body.failedDelta }),
            ...(body.status === undefined ? {} : { status: body.status }),
            ...(body.errorSummary === undefined ? {} : { error_summary: body.errorSummary }),
          },
        },
      ),
    fetchPatrolScanPage: async (params, traceId) =>
      request(
        `/internal/agent/patrol/scans/${z.number().int().positive().parse(params.jobId)}/page`,
        { limit: params.limit?.toString() },
        traceId, PatrolScanPageSchema,
      ),
    fetchPatrolFeedback: async (params, traceId) => {
      const data = await request(
        "/internal/agent/patrol/feedback",
        { days: params.days?.toString(), limit: params.limit?.toString() },
        traceId, PatrolFeedbackSchema,
      );
      return data.items;
    },
    createPatrolNotes: async (body, traceId, agentRunId) =>
      request(
        "/internal/agent/patrol/notes",
        { agent_run_id: agentRunId },
        traceId, PatrolNotesAckSchema, { method: "POST", body },
      ),
    expirePatrolNotes: async traceId =>
      request(
        "/internal/agent/patrol/notes/expire", {}, traceId,
        PatrolExpireAckSchema, { method: "POST", body: {} },
      ),
    fetchQaIndexSnapshot: async (params, traceId) =>
      request(
        "/internal/agent/qa-index/snapshot",
        {
          cursor: params.cursor === undefined ? undefined : String(params.cursor),
          limit: params.limit === undefined ? undefined : String(params.limit),
        },
        traceId, QaIndexPageSchema,
      ),
    fetchQaCandidates: async (params, traceId) => {
      if (config.authorization === undefined) throw new InternalApiError(401, 401, "需要用户登录凭证");
      const ids = z.array(z.number().int().positive()).min(1).max(50).parse(params.ids);
      const data = await request(
        "/internal/agent/user/qa-index/candidates", {}, traceId, QaCandidatesSchema,
        { method: "POST", body: {
          ids,
          ...(params.courseId === undefined ? {} : { course_id: params.courseId }),
        } },
      );
      const wanted = new Set(ids);
      if (data.total !== data.items.length
        || data.items.some(item => !wanted.has(item.id)
          || (params.courseId !== undefined && item.course_id !== params.courseId))) {
        throw new InternalApiError(502, 502, "候选复核响应与请求不一致");
      }
      return data.items;
    },
    fetchInjectedPatrolNotes: async (params, traceId) =>
      request(
        "/internal/agent/patrol/notes/injected",
        {
          max_chars: params.maxChars?.toString(),
          min_confidence: params.minConfidence?.toString(),
          limit: params.limit?.toString(),
        },
        traceId, InjectedPatrolNotesSchema,
      ),
  };
};

/** 默认实例：读环境变量；测试经 createInternalClient 注入 mock fetch */
export const defaultInternalClient = (authorization: string, signal?: AbortSignal): UserInternalClient =>
  createInternalClient({ ...resolveInternalConfig(), authorization, signal, fetchImpl: fetch });
