// suggest_tags handler（US-11/E-09）：只产出建议与置信度，写入由用户确认后经后端接口完成
import { generateStructured } from "../loop/self-check.js";
import { buildSuggestTagsPrompt, SUGGEST_TAGS_SYSTEM } from "../prompts/suggest-tags.js";
import { SuggestTagsInputSchema, SuggestTagsOutputSchema, type SuggestTagsInput } from "../types/index.js";
import type { TaskHandler } from "./router.js";

export const suggestTagsHandler: TaskHandler<SuggestTagsInput> = {
  taskType: "suggest_tags",
  inputSchema: SuggestTagsInputSchema,
  run: async (input, context) => {
    // TODO(T-13): 经 GET /internal/agent/tags 拉取已有标签 vocabulary，避免模型凭空造标签
    const vocabulary: string[] = [];
    return generateStructured({
      model: context.model,
      schema: SuggestTagsOutputSchema,
      system: SUGGEST_TAGS_SYSTEM,
      prompt: buildSuggestTagsPrompt(input, JSON.stringify(vocabulary)),
    });
  },
};
