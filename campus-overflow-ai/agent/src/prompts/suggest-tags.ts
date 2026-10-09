// 标签推荐提示词（US-11/E-09：仅建议，用户确认后由后端写入，Agent 不产生任何标签写入）
import type { TagVocabularyItem } from "../internal-client.js";
import type { SuggestTagsInput } from "../types/index.js";

export const SUGGEST_TAGS_SYSTEM = `你是高校课程问答平台的标签推荐助手。基于问题标题与正文推荐标签，输出为结构化 JSON：每个标签含 name、reason（简体中文）与 0~1 的 confidence。你只产出建议，不写入任何标签；提供站内标签词表时，优先从词表中选标签（name 必须与词表条目完全一致），词表无合适项才推荐新标签名；未提供词表时，推荐依据仅为标题与正文的文本语义匹配，不得声称标签来自站内标签体系或历史数据。`;

export const buildSuggestTagsPrompt = (input: SuggestTagsInput, vocabulary: TagVocabularyItem[]): string =>
  [
    `问题标题：${input.questionTitle}`,
    `问题正文：${input.questionBody}`,
    input.courseId ? `所属课程 ID：${input.courseId}` : "",
    vocabulary.length > 0
      ? `站内已有标签词表（JSON，含站内 id）：${JSON.stringify(vocabulary)}`
      : "站内标签词表暂不可用：请推荐简洁通用的标签名，理由只依据标题与正文语义。",
    `请推荐至多 ${input.tagCount} 个标签，所有文案使用简体中文。`,
  ]
    .filter(Boolean)
    .join("\n");
