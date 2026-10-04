import type {
  AnswerListItem,
  AnswerListResult,
  AnswerSort,
  CreateQuestionInput,
  CreatedQuestion,
  QuestionDetail,
  QuestionListItem,
  QuestionSort,
  VoteResult,
} from "@/shared/types/question";

import { apiFetch, apiFetchWithMessage } from "./client";

export function fetchQuestionDetail(id: number) {
  return apiFetch<QuestionDetail>(`/questions/${id}`);
}

export function fetchAnswers(id: number, sort: AnswerSort = "latest") {
  return apiFetch<AnswerListResult>(`/questions/${id}/answers?sort=${sort}&page=1&page_size=20`);
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

export function createQuestion(input: CreateQuestionInput) {
  // 用 WithMessage 版本：超长截断提示由后端放在 message 里（E-02）
  return apiFetchWithMessage<CreatedQuestion>("/questions", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

/** 相关问题（GET /api/questions/{id}/related）：返回与列表条目同构的 items */
export function fetchRelatedQuestions(id: number) {
  return apiFetch<{ items: QuestionListItem[] }>(`/questions/${id}/related`);
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
