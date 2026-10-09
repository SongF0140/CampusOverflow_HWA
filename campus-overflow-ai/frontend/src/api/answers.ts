// 回答域接口：列表/发布/采纳在 interaction 路由，编辑/删除/推荐/认证在 qa 路由
// 契约来源：学生端接口文档 §4、qa/router.py、interaction/router.py
import type {
  AcceptResult,
  Answer,
  AnswerCreated,
  AnswerListParams,
  AnswerListResult,
  AnswerRecord,
  CertifyResult,
  RecommendResult,
} from "@/shared/types/answer";

import { apiFetch, buildQuery } from "./client";

// GET /questions/{id}/answers：回答列表（sort=latest|votes|accepted）
export function listAnswers(questionId: number, params: AnswerListParams = {}) {
  return apiFetch<AnswerListResult>(
    `/questions/${questionId}/answers${buildQuery(params)}`,
  );
}

// POST /questions/{id}/answers：发布回答（同事务通知提问者）
export function createAnswer(questionId: number, body: string) {
  return apiFetch<AnswerCreated>(`/questions/${questionId}/answers`, {
    method: "POST",
    body: JSON.stringify({ body }),
  });
}

// PATCH /answers/{id}：编辑回答（仅作者）
export function updateAnswer(answerId: number, body: string) {
  return apiFetch<AnswerRecord>(`/answers/${answerId}`, {
    method: "PATCH",
    body: JSON.stringify({ body }),
  });
}

// DELETE /answers/{id}：软删除回答（作者或管理员；已采纳回答级联撤销采纳）
export function deleteAnswer(answerId: number) {
  return apiFetch<{ deleted: boolean }>(`/answers/${answerId}`, { method: "DELETE" });
}

// POST /answers/{id}/accept：提问者采纳回答
export function acceptAnswer(answerId: number) {
  return apiFetch<AcceptResult>(`/answers/${answerId}/accept`, { method: "POST" });
}

// POST /answers/{id}/recommend：助教推荐标记（true 标记 / false 取消）
export function recommendAnswer(answerId: number, recommended: boolean) {
  return apiFetch<RecommendResult>(`/answers/${answerId}/recommend`, {
    method: "POST",
    body: JSON.stringify({ recommended }),
  });
}

// POST /answers/{id}/certify：负责教师置位优质内容认证
export function certifyAnswer(answerId: number) {
  return apiFetch<CertifyResult>(`/answers/${answerId}/certify`, { method: "POST" });
}

// DELETE /answers/{id}/certify：负责教师取消优质内容认证
export function uncertifyAnswer(answerId: number) {
  return apiFetch<CertifyResult>(`/answers/${answerId}/certify`, { method: "DELETE" });
}
