// 回答类型：字段与后端 qa/schemas.py AnswerListItemResponse / AnswerResponse 一致（蛇形）
// 契约来源：docs/后端架构/学生端接口文档.md §4

// 回答列表条目（GET /questions/{id}/answers）：is_accepted 由提问采纳关系判定
export interface Answer {
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

// 回答列表回包：注意后端只返回 items/total/page，无 page_size
export interface AnswerListResult {
  items: Answer[];
  total: number;
  page: number;
}

// 编辑回答回包（PATCH /answers/{id}）：qa/schemas.py AnswerResponse 完整记录
export interface AnswerRecord {
  id: number;
  body: string;
  question_id: number;
  author_id: number;
  vote_score: number;
  recommended_by_assistant: boolean;
  certified_by_teacher: boolean;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

// 发布回答回包（POST /questions/{id}/answers）
export interface AnswerCreated {
  id: number;
  status: string;
  created_at: string;
}

// 助教推荐标记回包（POST /answers/{id}/recommend）
export interface RecommendResult {
  answer_id: number;
  recommended_by_assistant: boolean;
}

// 教师认证回包（POST/DELETE /answers/{id}/certify）
export interface CertifyResult {
  answer_id: number;
  certified_by_teacher: boolean;
}

// 采纳回包（POST /answers/{id}/accept）
export interface AcceptResult {
  accepted: boolean;
  question_status: string;
}

export type AnswerSort = "latest" | "votes" | "accepted";

export interface AnswerListParams {
  sort?: AnswerSort;
  page?: number;
  page_size?: number;
}
