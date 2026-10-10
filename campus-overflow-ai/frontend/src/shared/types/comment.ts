// 评论类型：字段与后端 qa/schemas.py CommentListItemResponse / CommentReplyResponse 一致（蛇形）
// 契约来源：docs/后端架构/学生端接口文档.md §5

// 二级回复（挂顶级评论的 replies 数组内，二级限制下无下级）
export interface CommentReply {
  id: number;
  author: string;
  body: string;
  parent_id: number;
  created_at: string;
}

// 评论列表条目：顶级评论分页，二级回复归组 replies（不重复出现在顶级）
export interface Comment {
  id: number;
  author: string;
  body: string;
  parent_id: number | null;
  created_at: string;
  replies: CommentReply[];
}

// 评论列表回包：注意后端只返回 items/total/page，无 page_size
export interface CommentListResult {
  items: Comment[];
  total: number;
  page: number;
}

// 发表评论回包（POST /questions/{id}/comments、POST /answers/{id}/comments）
export interface CommentCreated {
  id: number;
  parent_id: number | null;
  created_at: string;
}

export interface CommentCreateInput {
  body: string;
  parent_id?: number;
}

export interface CommentListParams {
  page?: number;
  page_size?: number;
}
