// similar_questions handler（US-12）：先检索站内候选，再让模型排序并给理由；仅建议不写入
import { generateStructured } from "../loop/self-check.js";
import { buildSimilarQuestionsPrompt, SIMILAR_QUESTIONS_SYSTEM } from "../prompts/similar-questions.js";
import {
  SimilarQuestionsInputSchema,
  SimilarQuestionsOutputSchema,
  type SimilarQuestionsInput,
} from "../types/index.js";
import type { TaskHandler } from "./router.js";

export const similarQuestionsHandler: TaskHandler<SimilarQuestionsInput> = {
  taskType: "similar_questions",
  inputSchema: SimilarQuestionsInputSchema,
  run: async (input, context) => {
    // 候选检索经内部白名单接口（C-05）；无客户端时以空候选运行，模型须声明无站内依据
    const candidates = context.internalClient
      ? await context.internalClient.searchQuestions(
          { keyword: input.questionTitle, courseId: input.courseId, limit: input.limit },
          context.runContext.traceId,
        )
      : [];
    return generateStructured({
      model: context.model,
      schema: SimilarQuestionsOutputSchema,
      system: SIMILAR_QUESTIONS_SYSTEM,
      prompt: buildSimilarQuestionsPrompt(input, JSON.stringify(candidates)),
    });
  },
};
