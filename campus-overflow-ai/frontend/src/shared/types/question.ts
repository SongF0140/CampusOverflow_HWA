import type { AnswerSort, QuestionSort, QuestionStatus } from "@/shared/constants/domain";

export type { AnswerSort, QuestionSort };

// 问题相关类型：字段与后端 qa / interaction 模块的响应 Schema 完全一致（蛇形）
// 契约来源：docs/后端架构/学生端接口文档.md §3、qa/schemas.py QuestionListItemResponse / QuestionDetailResponse
export interface TagBrief {
  id: number;
  name: string;
  type: string;
}

export interface QuestionListItem {
  id: number;
  title: string;
  course_id: number;
  author: string;
  tags: TagBrief[];
  status: QuestionStatus;
  vote_score: number;
  my_vote: number;
  answer_count: number;
  view_count: number;
  has_accepted: boolean;
  created_at: string;
}

export interface QuestionListResult {
  items: QuestionListItem[];
  total: number;
  page: number;
  page_size: number;
}

/** 问题详情（GET /api/questions/{id}）：字段对齐 qa/schemas.py QuestionDetailResponse */
export interface QuestionDetail {
  id: number;
  title: string;
  body: string;
  course_id: number;
  author: string;
  tags: TagBrief[];
  status: QuestionStatus;
  vote_score: number;
  my_vote: number;
  accepted_answer_id: number | null;
  view_count: number;
  created_at: string;
  updated_at: string;
}

/** 回答列表条目：字段对齐 qa/schemas.py AnswerListItemResponse */
export interface AnswerListItem {
  id: number;
  author: string;
  body: string;
  vote_score: number;
  my_vote: number;
  is_accepted: boolean;
  recommended_by_assistant: boolean;
  certified_by_teacher: boolean;
  created_at: string;
}

export interface AnswerListResult {
  items: AnswerListItem[];
  total: number;
  page: number;
}

/** 发布问题请求（POST /api/questions）；返回 { id, title, status, created_at } */
export interface CreateQuestionInput {
  title: string;
  body: string;
  course_id: number;
  tag_ids?: number[] | null;
}

export interface CreatedQuestion {
  id: number;
  title: string;
  status: QuestionStatus;
  created_at: string;
}

/** 投票结果（POST /api/votes）：后端为 toggle 语义 */
export interface VoteResult {
  target_type: string;
  target_id: number;
  vote_score: number;
  my_vote: number;
}

/** 二级回复（qa/schemas.py CommentReplyResponse）：二级限制下没有下级 */
export interface CommentReply {
  id: number;
  author: string;
  body: string;
  parent_id: number;
  created_at: string;
}

/** 顶级评论（qa/schemas.py CommentListItemResponse）：二级回复归组在 replies */
export interface CommentListItem {
  id: number;
  author: string;
  body: string;
  parent_id: number | null;
  created_at: string;
  replies: CommentReply[];
}

export interface CommentListResult {
  items: CommentListItem[];
  total: number;
  page: number;
}
