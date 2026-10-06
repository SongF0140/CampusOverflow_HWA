// 共享类型与任务入参校验：跨模块类型只在此定义，边界入参一律 Zod 校验
import { z } from "zod";

/** 品牌类型：仅允许经 asAgentRunId / asTraceId 收敛构造，避免裸字符串混用 */
type Brand<T, B extends string> = T & { readonly __brand: B };

export type AgentRunId = Brand<string, "AgentRunId">;
export type TraceId = Brand<string, "TraceId">;

export const asAgentRunId = (value: string): AgentRunId => value as AgentRunId;
export const asTraceId = (value: string): TraceId => value as TraceId;

/** 第一阶段任务类型（specs/plan.md §4 AgentRun.taskType） */
export const TaskTypeSchema = z.enum([
  "similar_questions",
  "suggest_tags",
  "moderation_scan",
  "doc_draft",
]);
export type TaskType = z.infer<typeof TaskTypeSchema>;

/** 工具/任务风险等级；medium 及以上只保留类型位，执行策略随 T-15 审批工单落地 */
export type RiskLevel = "low" | "medium" | "high";

/** 与后端 core/response.py 对齐的统一响应封装 */
export interface ApiResponse<T> {
  code: number;
  data: T;
  message: string;
}

/** similar_questions 任务入参（US-12：提交前推荐相似问题） */
export const SimilarQuestionsInputSchema = z.object({
  questionTitle: z.string().min(1).max(100),
  questionBody: z.string().min(1).max(20000),
  courseId: z.number().int().positive().optional(),
  limit: z.number().int().min(1).max(10).default(5),
});
export type SimilarQuestionsInput = z.infer<typeof SimilarQuestionsInputSchema>;

/** similar_questions 结构化输出（自检 schema） */
export const SimilarQuestionsOutputSchema = z.object({
  items: z.array(
    z.object({
      questionId: z.number().int().positive(),
      title: z.string().min(1),
      url: z.string().min(1),
      reason: z.string().min(1),
    }),
  ),
  hasInSiteEvidence: z.boolean(),
});
export type SimilarQuestionsOutput = z.infer<typeof SimilarQuestionsOutputSchema>;

/** suggest_tags 任务入参（US-11：推荐标签，用户确认后才写入，E-09） */
export const SuggestTagsInputSchema = z.object({
  questionTitle: z.string().min(1).max(100),
  questionBody: z.string().min(1).max(20000),
  courseId: z.number().int().positive().optional(),
  tagCount: z.number().int().min(1).max(5).default(3),
});
export type SuggestTagsInput = z.infer<typeof SuggestTagsInputSchema>;

/** suggest_tags 结构化输出 */
export const SuggestTagsOutputSchema = z.object({
  tags: z.array(
    z.object({
      name: z.string().min(1).max(50),
      reason: z.string().min(1),
      confidence: z.number().min(0).max(1),
    }),
  ),
});
export type SuggestTagsOutput = z.infer<typeof SuggestTagsOutputSchema>;

/** moderation_scan 任务入参（US-13：内容风险扫描；处置动作一律走 T-15 审批工单） */
export const ModerationScanInputSchema = z.object({
  targetType: z.enum(["question", "answer", "comment"]),
  targetId: z.number().int().positive(),
  contentExcerpt: z.string().min(1).max(2000),
});
export type ModerationScanInput = z.infer<typeof ModerationScanInputSchema>;

/** moderation_scan 结构化输出：仅给出评估与升级建议，不执行任何处置 */
export const ModerationScanOutputSchema = z.object({
  riskLevel: z.enum(["low", "medium", "high"]),
  shouldEscalate: z.boolean(),
  reason: z.string().min(1),
});
export type ModerationScanOutput = z.infer<typeof ModerationScanOutputSchema>;

/** doc_draft 任务入参（起草讲解文档草稿，仅草稿不发布） */
export const DocDraftInputSchema = z.object({
  topic: z.string().min(1).max(200),
  courseId: z.number().int().positive().optional(),
});
export type DocDraftInput = z.infer<typeof DocDraftInputSchema>;

/** doc_draft 结构化输出 */
export const DocDraftOutputSchema = z.object({
  title: z.string().min(1).max(200),
  bodyMarkdown: z.string().min(1),
});
export type DocDraftOutput = z.infer<typeof DocDraftOutputSchema>;
