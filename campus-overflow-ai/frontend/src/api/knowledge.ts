// 知识树 / 教学计划 / 周报 API（KN-R01~03，K-05）：
// 业务读写走同源 BFF（/api/backend/api/**）；大纲分析走 Agent BFF（/api/agent/agent/tasks/*）。
import { apiFetch, apiFetchWithMessage } from "./client";
import type {
  KnowledgeTree,
  KnowledgeTreeSuggestion,
  KnowledgeTreeTaskInput,
  TeachingPlanItem,
  WeeklyReport,
} from "@/shared/types/knowledge";

export function fetchKnowledgeTree(courseId: number) {
  return apiFetch<KnowledgeTree>(`/courses/${courseId}/knowledge-tree`);
}

/** 教师确认写入知识点（AI 建议确认与手动新增共用；E-15 重复由后端拒绝） */
export function addKnowledgeNodes(courseId: number, names: string[]) {
  return apiFetchWithMessage<KnowledgeTree>(`/courses/${courseId}/knowledge-tree/nodes`, {
    method: "POST",
    body: JSON.stringify({ names }),
  });
}

export function deleteKnowledgeNode(courseId: number, nodeId: number) {
  return apiFetchWithMessage<KnowledgeTree>(
    `/courses/${courseId}/knowledge-tree/nodes/${nodeId}`,
    { method: "DELETE" },
  );
}

export function fetchTeachingPlan(courseId: number) {
  return apiFetch<{ items: TeachingPlanItem[]; total: number }>(
    `/courses/${courseId}/teaching-plan`,
  );
}

/** 新增教学计划条目：带 report_id 即周报差距一键加入（KN-R03） */
export function createTeachingPlanItem(
  courseId: number,
  input: { title: string; detail?: string | null; report_id?: number },
) {
  return apiFetchWithMessage<TeachingPlanItem>(`/courses/${courseId}/teaching-plan`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updateTeachingPlanItem(
  courseId: number,
  itemId: number,
  input: { title?: string; detail?: string | null; status?: string },
) {
  return apiFetchWithMessage<TeachingPlanItem>(
    `/courses/${courseId}/teaching-plan/${itemId}`,
    { method: "PATCH", body: JSON.stringify(input) },
  );
}

export function deleteTeachingPlanItem(courseId: number, itemId: number) {
  return apiFetchWithMessage<{ deleted: boolean }>(
    `/courses/${courseId}/teaching-plan/${itemId}`,
    { method: "DELETE" },
  );
}

export function fetchWeeklyReports(courseId: number) {
  return apiFetch<{ items: WeeklyReport[]; total: number }>(
    `/courses/${courseId}/weekly-reports`,
  );
}

/**
 * 大纲分析任务（Agent，KN-R01）：粘贴教材大纲 → AI 知识点建议。
 * 纯建议不写入；确认后经 addKnowledgeNodes 写入（E-17）。
 */
export async function analyzeOutline(input: KnowledgeTreeTaskInput) {
  const response = await fetch("/api/agent/agent/tasks/knowledge_tree", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
    cache: "no-store",
  });
  const envelope = (await response.json()) as {
    code: number;
    data: KnowledgeTreeSuggestion | null;
    message: string;
  };
  if (!response.ok || envelope.code !== 200 || envelope.data === null) {
    throw new Error(envelope.message || "大纲分析暂不可用，请稍后重试");
  }
  return envelope.data;
}
