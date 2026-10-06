// suggest_tags handler（US-11/E-09）：只产出建议与置信度，写入由用户确认后经后端标签绑定接口完成
// 词表来源（T-13 补口）：GET /internal/agent/tags 提供站内标签词表（服务间 token 鉴权）；
// 缺客户端、拉取失败或词表为空时一律降级为纯文本语义匹配，basisNote 原样明确依据（E-09）。
import type { TagVocabularyItem } from "../internal-client.js";
import { generateStructured } from "../loop/self-check.js";
import { buildSuggestTagsPrompt, SUGGEST_TAGS_SYSTEM } from "../prompts/suggest-tags.js";
import {
  SuggestTagsInputSchema,
  SuggestTagsModelOutputSchema,
  SuggestTagsOutputSchema,
  type SuggestTagsInput,
  type SuggestTagsOutput,
} from "../types/index.js";
import type { TaskHandler } from "./router.js";

/** E-09 依据说明：无站内词表与历史数据可用时必须原样明确（任务 T-13 完成判定） */
export const TEXT_ONLY_BASIS_NOTE = "依据为文本语义匹配，无站内历史数据依据。";

/** 有词表且命中时的依据说明：tagId 为命中的站内标签 id，用户确认后据此绑定 */
export const VOCABULARY_BASIS_NOTE = "依据为站内标签词表匹配与文本语义匹配，命中词表的标签已附站内 id。";

/** 词表拉取上限：与后端 GET /internal/agent/tags 默认 limit 对齐 */
const TAG_VOCABULARY_LIMIT = 100;

export const suggestTagsHandler: TaskHandler<SuggestTagsInput> = {
  taskType: "suggest_tags",
  inputSchema: SuggestTagsInputSchema,
  run: async (input, context) => {
    // 词表仅经内部白名单 GET 接口（C-05）；失败时降级为空词表运行，不阻塞推荐
    let vocabulary: TagVocabularyItem[] = [];
    if (context.internalClient) {
      try {
        vocabulary = await context.internalClient.fetchTags(
          { limit: TAG_VOCABULARY_LIMIT },
          context.runContext.traceId,
        );
      } catch {
        vocabulary = [];
      }
    }
    const modelOutput = await generateStructured({
      model: context.model,
      schema: SuggestTagsModelOutputSchema,
      system: SUGGEST_TAGS_SYSTEM,
      prompt: buildSuggestTagsPrompt(input, vocabulary),
    });
    // 站内 id 由 handler 按名称与词表精确匹配后确定性映射，不信任模型自报
    const vocabularyByName = new Map(vocabulary.map((tag) => [tag.name, tag]));
    const tags = modelOutput.tags.slice(0, input.tagCount).map(
      (tag): SuggestTagsOutput["tags"][number] => {
        const matched = vocabularyByName.get(tag.name);
        return matched ? { ...tag, tagId: matched.id } : tag;
      },
    );
    return SuggestTagsOutputSchema.parse({
      tags,
      basisNote: tags.some((tag) => tag.tagId !== undefined)
        ? VOCABULARY_BASIS_NOTE
        : TEXT_ONLY_BASIS_NOTE,
    });
  },
};
