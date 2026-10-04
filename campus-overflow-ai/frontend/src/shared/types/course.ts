// 课程类型：字段对齐 courses/schemas.py（蛇形）
export interface CourseListItem {
  id: number;
  name: string;
  code: string;
  teacher_name: string;
  member_count: number;
  question_count: number;
  created_at: string;
}

export interface CourseListResult {
  items: CourseListItem[];
  total: number;
  page: number;
  page_size: number;
}

/** 课程详情（GET /api/courses/{id}）：前端用它取课程名做面包屑，joined 判断加入状态 */
export interface CourseDetail {
  id: number;
  name: string;
  code: string;
  description: string | null;
  semester: string | null;
  teacher_name: string;
  joined: boolean;
  aggregates: Record<string, unknown>;
  created_at: string;
}
