import type { Paged } from "@/shared/types/common";
import type {
  AnswerListItem,
  AnswerListResult,
  AnswerSort,
  CreateQuestionInput,
  CreatedQuestion,
  CommentListResult,
  QuestionDetail,
  QuestionListItem,
  QuestionListParams,
  QuestionSort,
  VoteResult,
} from "@/shared/types/question";

import { apiFetch, apiFetchWithMessage, buildQuery } from "./client";

/**
 * 问题列表（GET /api/questions）：可选参数缺省不出现在查询串（buildQuery 跳过 undefined/空串），
 * 返回分页信封。问题广场等 URL 驱动页面统一走这里。
 */
export function listQuestions(
  params: QuestionListParams & { page?: number; page_size?: number } = {},
) {
  return apiFetch<Paged<QuestionListItem>>(
    `/questions${buildQuery({ ...params, keyword: params.keyword?.trim() || undefined })}`,
  );
}

export function fetchQuestionDetail(id: number) {
  return apiFetch<QuestionDetail>(`/questions/${id}`);
}

/** 问题详情的历史命名别名（= fetchQuestionDetail） */
export function getQuestion(id: number) {
  return fetchQuestionDetail(id);
}

/**
 * 编辑问题（PATCH /api/questions/{id}）：**只支持 title / body**（后端 QuestionUpdateRequest
 * 没有 course_id 与 tagIds，课程与标签不可改）。仅作者可调用，非作者后端返回 403。
 * 用 WithMessage 版本拿 E-02 提示后解出数据体，与其他 api 函数「直接返回数据」的约定一致。
 */
export async function updateQuestion(id: number, input: { title?: string; body?: string }) {
  const { data } = await apiFetchWithMessage<{ id: number; title: string; updated_at: string }>(
    `/questions/${id}`,
    { method: "PATCH", body: JSON.stringify(input) },
  );
  return data;
}

/** 软删除问题（作者或管理员）：后端返回 { deleted: true } */
export function deleteQuestion(id: number) {
  return apiFetch<{ deleted: boolean }>(`/questions/${id}`, { method: "DELETE" });
}

export function fetchAnswers(id: number, sort: AnswerSort = "latest", page = 1, pageSize = 20) {
  return apiFetch<AnswerListResult>(
    `/questions/${id}/answers?sort=${sort}&page=${page}&page_size=${pageSize}`,
  );
}

export function createAnswer(questionId: number, body: string) {
  return apiFetch<{ id: number; status: string; created_at: string }>(
    `/questions/${questionId}/answers`,
    { method: "POST", body: JSON.stringify({ body }) },
  );
}

/** 采纳：后端返回 { accepted: true, question_status: "resolved" } */
export function acceptAnswer(answerId: number) {
  return apiFetch<{ accepted: boolean; question_status: string }>(`/answers/${answerId}/accept`, {
    method: "POST",
  });
}

/**
 * 优质内容认证 / 取消（D9 定案）：POST 置位、DELETE 取消。
 * 后端要求教师角色 + 必须是回答所在课程的负责教师（管理员不豁免）。
 */
export function certifyAnswer(answerId: number) {
  return apiFetch<{ answer_id: number; certified_by_teacher: boolean }>(
    `/answers/${answerId}/certify`,
    { method: "POST" },
  );
}

export function uncertifyAnswer(answerId: number) {
  return apiFetch<{ answer_id: number; certified_by_teacher: boolean }>(
    `/answers/${answerId}/certify`,
    { method: "DELETE" },
  );
}

export async function createQuestion(input: CreateQuestionInput) {
  // 用 WithMessage 版本：超长截断提示由后端放在 message 里（E-02），解出数据体返回
  const { data } = await apiFetchWithMessage<CreatedQuestion>("/questions", {
    method: "POST",
    body: JSON.stringify(input),
  });
  return data;
}

/** 绑定标签（POST /api/questions/{id}/tags）：tag_ids 支持已有标签 id 或新标签名 */
export function bindQuestionTags(questionId: number, tagIds: Array<number | string>) {
  return apiFetch<QuestionDetail>(`/questions/${questionId}/tags`, {
    method: "POST",
    body: JSON.stringify({ tag_ids: tagIds }),
  });
}

/** 相关问题（GET /api/questions/{id}/related）：返回与列表条目同构的 items */
export function fetchRelatedQuestions(id: number) {
  return apiFetch<{ items: QuestionListItem[] }>(`/questions/${id}/related`);
}

/** 问题评论（GET /api/questions/{id}/comments）：顶级评论分页，二级回复在 replies 里 */
export function fetchQuestionComments(id: number, page = 1) {
  return apiFetch<CommentListResult>(`/questions/${id}/comments?page=${page}&page_size=20`);
}

/** 发表评论 / 二级回复（parent_id 给定时为回复） */
export function createQuestionComment(questionId: number, body: string, parentId?: number) {
  return apiFetch<{ id: number; parent_id: number | null; created_at: string }>(
    `/questions/${questionId}/comments`,
    {
      method: "POST",
      body: JSON.stringify(parentId ? { body, parent_id: parentId } : { body }),
    },
  );
}

/** 删除评论（作者或管理员）：后端为软删，顶级评论会级联其直接回复 */
export function deleteComment(commentId: number) {
  return apiFetch<null>(`/comments/${commentId}`, { method: "DELETE" });
}

/** 投票：value=1 赞 / -1 踩；同方向重复提交 = 取消（后端 toggle 语义） */
export function vote(targetType: "question" | "answer", targetId: number, value: 1 | -1) {
  return apiFetch<VoteResult>("/votes", {
    method: "POST",
    body: JSON.stringify({ target_type: targetType, target_id: targetId, value }),
  });
}

/** 问题列表（真接口）：参数与后端 GET /api/questions 一致 */
export function fetchQuestionList(params: {
  page?: number;
  page_size?: number;
  sort?: QuestionSort;
  unresolved?: boolean;
  keyword?: string;
  course_id?: number;
  tag_id?: number;
}) {
  const query = new URLSearchParams();
  query.set("page", String(params.page ?? 1));
  query.set("page_size", String(params.page_size ?? 20));
  query.set("sort", params.sort ?? "latest");
  if (params.unresolved) query.set("unresolved", "true");
  if (params.keyword?.trim()) query.set("keyword", params.keyword.trim());
  if (params.course_id) query.set("course_id", String(params.course_id));
  if (params.tag_id) query.set("tag_id", String(params.tag_id));
  return apiFetch<{
    items: QuestionListItem[];
    total: number;
    page: number;
    page_size: number;
  }>(`/questions?${query.toString()}`);
}
