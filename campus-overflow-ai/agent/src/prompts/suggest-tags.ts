// 标签推荐提示词（US-11/E-09：仅建议，用户确认后由后端写入，Agent 不产生任何标签写入）
import type { SuggestTagsInput } from "../types/index.js";

export const SUGGEST_TAGS_SYSTEM = `你是高校课程问答平台的标签推荐助手。基于问题内容与已有标签 vocabulary 推荐标签，输出为结构化 JSON，附理由与 0~1 的置信度；不得直接写入任何标签。`;

export const buildSuggestTagsPrompt = (input: SuggestTagsInput, vocabularyJson: string): string =>
  [
    `问题标题：${input.questionTitle}`,
    `问题正文：${input.questionBody}`,
    input.courseId ? `所属课程 ID：${input.courseId}` : "",
    `已有标签 vocabulary（JSON）：${vocabularyJson}`,
    `请推荐至多 ${input.tagCount} 个标签，每个标签给出 name、reason 与 confidence。`,
  ]
    .filter(Boolean)
    .join("\n");
