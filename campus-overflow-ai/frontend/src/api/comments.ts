// 评论域接口：GET 列表与 DELETE 在 qa 路由，POST 发表（同事务通知）在 interaction 路由
// 契约来源：学生端接口文档 §5
import type {
  CommentCreateInput,
  CommentCreated,
  CommentListParams,
  CommentListResult,
} from "@/shared/types/comment";

import { apiFetch, buildQuery } from "./client";

// GET /questions/{id}/comments：问题评论列表（顶级分页，二级归组 replies）
export function listQuestionComments(
  questionId: number,
  params: CommentListParams = {},
) {
  return apiFetch<CommentListResult>(
    `/questions/${questionId}/comments${buildQuery(params)}`,
  );
}

// POST /questions/{id}/comments：评论问题（parent_id 给定时为二级回复）
export function createQuestionComment(questionId: number, input: CommentCreateInput) {
  return apiFetch<CommentCreated>(`/questions/${questionId}/comments`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

// GET /answers/{id}/comments：回答评论列表
export function listAnswerComments(answerId: number, params: CommentListParams = {}) {
  return apiFetch<CommentListResult>(
    `/answers/${answerId}/comments${buildQuery(params)}`,
  );
}

// POST /answers/{id}/comments：评论回答
export function createAnswerComment(answerId: number, input: CommentCreateInput) {
  return apiFetch<CommentCreated>(`/answers/${answerId}/comments`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

// DELETE /comments/{id}：软删除评论（作者或管理员）
export function deleteComment(commentId: number) {
  return apiFetch<{ deleted: boolean }>(`/comments/${commentId}`, { method: "DELETE" });
}
