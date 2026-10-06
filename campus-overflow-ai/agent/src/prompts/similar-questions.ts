// 相似问题推荐提示词（US-12：仅建议、附链接与理由；无站内依据时明确说明）
import type { SimilarQuestionsInput } from "../types/index.js";

export const SIMILAR_QUESTIONS_SYSTEM = `你是高校课程问答平台的相似问题推荐助手。只依据给定的站内候选问题做推荐，不得编造站内不存在的问题；若候选为空，须如实说明没有站内依据。输出为结构化 JSON。`;

export const buildSimilarQuestionsPrompt = (input: SimilarQuestionsInput, candidatesJson: string): string =>
  [
    `新问题标题：${input.questionTitle}`,
    `新问题正文：${input.questionBody}`,
    input.courseId ? `所属课程 ID：${input.courseId}` : "",
    `站内候选问题（JSON）：${candidatesJson}`,
    `请从候选中挑选至多 ${input.limit} 个相似问题，给出 questionId、title、url（/questions/{id}）与推荐理由；并在 hasInSiteEvidence 中说明是否存在站内依据。`,
  ]
    .filter(Boolean)
    .join("\n");
