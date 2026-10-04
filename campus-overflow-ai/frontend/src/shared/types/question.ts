// 问题相关类型：字段与后端 qa / interaction 模块的响应 Schema 完全一致（蛇形）
// 契约来源：docs/后端架构/学生端接口文档.md §3、qa/schemas.py QuestionListItemResponse
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
  status: string;
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

export type QuestionSort = "latest" | "hot";

export interface QuestionListParams {
  page?: number;
  page_size?: number;
  course_id?: number;
  tag_id?: number;
  sort?: QuestionSort;
  unresolved?: boolean;
  keyword?: string;
}
