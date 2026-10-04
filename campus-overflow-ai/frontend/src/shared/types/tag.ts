// 标签类型：字段与后端 qa/schemas.py TagResponse 一致（蛇形）
export interface TagListItem {
  id: number;
  name: string;
  type: string;
  question_count: number;
}
