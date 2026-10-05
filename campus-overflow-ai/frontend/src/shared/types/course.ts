import type { QuestionListItem } from "./question";
import type { TagListItem } from "./tag";

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

export interface CourseActiveUser {
  user_id: number;
  username: string;
  activity_count: number;
}

/** 课程四聚合区块（discovery/schemas.py CourseAggregates） */
export interface CourseAggregates {
  hot_questions: QuestionListItem[];
  frequent_questions: QuestionListItem[];
  tags: TagListItem[];
  active_users: CourseActiveUser[];
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
  aggregates: CourseAggregates;
  created_at: string;
}
