// 知识树 / 教学计划 / 周报共享类型（KN-R01~03，K-05）
// 字段与后端 courses 模块蛇形契约一一对应。

export interface KnowledgeNode {
  id: number;
  name: string;
  sort_key: string;
  parent_id: number | null;
  position: "left" | "right" | null;
  source: "teacher" | "report" | string;
  created_at: string;
}

export interface KnowledgeTreeNode {
  id: number;
  name: string;
  sort_key: string;
  position: "left" | "right" | null;
  source: string;
  children: KnowledgeTreeNode[];
}

export interface KnowledgeTree {
  course_id: number;
  nodes: KnowledgeNode[];
  tree: KnowledgeTreeNode[];
  inorder: KnowledgeNode[];
}

export interface TeachingPlanItem {
  id: number;
  course_id: number;
  teacher_id: number;
  title: string;
  detail: string | null;
  source: "manual" | "report" | string;
  report_id: number | null;
  status: "pending" | "done" | string;
  created_at: string;
  updated_at: string;
}

export interface UncoveredTopic {
  topic: string;
  question_count: number;
  suggestion: string;
}

export interface HeatmapEntry {
  node_id: number;
  node_name: string;
  question_count: number;
}

export interface WeeklyReport {
  id: number;
  course_id: number;
  teacher_id: number;
  week_start: string;
  week_end: string;
  content: string;
  uncovered_topics: UncoveredTopic[];
  heatmap: HeatmapEntry[];
  question_count: number;
  agent_run_id: string;
  created_at: string;
}

/** knowledge_tree 任务（Agent）输入：教师粘贴的教材大纲 */
export interface KnowledgeTreeTaskInput {
  courseId: number;
  outlineText: string;
}

/** knowledge_tree 任务输出：纯建议，教师确认后才写入（E-17） */
export interface KnowledgeTreeSuggestion {
  nodes: Array<{ name: string; reason: string }>;
  notes: string;
}
