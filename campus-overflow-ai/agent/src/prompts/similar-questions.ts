// 相似问题推荐提示词（US-12：仅建议、附链接与理由；无站内依据时由 handler 直接返回明确说明，不空转模型）
import type { SimilarQuestionsInput } from "../types/index.js";

export const SIMILAR_QUESTIONS_SYSTEM = `你是高校课程问答平台的相似问题推荐助手。只依据给定的站内候选问题做挑选与排序，不得编造站内不存在的问题。输出为结构化 JSON：items 数组按相似度从高到低，每项只含 questionId 与 reason（简体中文）；标题与链接由系统依据站内数据补全。`;

export const buildSimilarQuestionsPrompt = (input: SimilarQuestionsInput, candidatesJson: string): string =>
  [
    `新问题标题：${input.questionTitle}`,
    input.questionBody ? `新问题正文：${input.questionBody}` : "新问题正文：（空）",
    input.courseId ? `所属课程 ID：${input.courseId}` : "",
    `站内候选问题（JSON，字段含 id/title/courseId）：${candidatesJson}`,
    `请从候选中挑选至多 ${input.limit} 个最相似的问题，按相似度降序输出 questionId 与 reason；未入选的候选不要输出。`,
  ]
    .filter(Boolean)
    .join("\n");
