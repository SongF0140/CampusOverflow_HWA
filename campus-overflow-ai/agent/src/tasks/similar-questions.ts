// similar_questions handler（US-12）：先经内部白名单 GET 接口检索站内候选，再让模型挑选与解释；
// 标题与链接一律取自站内候选组装（防模型编造），无命中或无客户端时直接返回明确说明，不做模型空转
import { generateStructured } from "../loop/self-check.js";
import { buildSimilarQuestionsPrompt, SIMILAR_QUESTIONS_SYSTEM } from "../prompts/similar-questions.js";
import {
  SimilarQuestionsInputSchema,
  SimilarQuestionsModelOutputSchema,
  SimilarQuestionsOutputSchema,
  type SimilarQuestionsInput,
} from "../types/index.js";
import type { TaskHandler } from "./router.js";

/** 无站内依据的分类说明：客户端缺位 / 站内无命中 / 候选相似度不足 */
const buildNoEvidenceNote = (reason: "client-missing" | "no-hits" | "low-similarity"): string => {
  if (reason === "client-missing") {
    return "未接入站内问题检索服务，本次推荐无站内依据。";
  }
  if (reason === "no-hits") {
    return "未在站内检索到相似的历史问题，本次推荐无站内依据，建议直接提交新问题。";
  }
  return "站内候选与该问题相似度不足，本次推荐无站内依据。";
};

export const similarQuestionsHandler: TaskHandler<SimilarQuestionsInput> = {
  taskType: "similar_questions",
  inputSchema: SimilarQuestionsInputSchema,
  run: async (input, context) => {
    // 候选检索仅经内部白名单 GET 接口（C-05）；无客户端时以无依据模式运行
    const candidates = context.internalClient
      ? await context.internalClient.searchQuestions(
          { keyword: input.questionTitle, courseId: input.courseId, limit: input.limit },
          context.runContext.traceId,
        )
      : [];
    // 无客户端或无命中：直接给出明确说明而非空转模型（任务 T-13 完成判定）
    if (candidates.length === 0) {
      return SimilarQuestionsOutputSchema.parse({
        items: [],
        hasInSiteEvidence: false,
        note: buildNoEvidenceNote(context.internalClient ? "no-hits" : "client-missing"),
      });
    }
    const modelOutput = await generateStructured({
      model: context.model,
      schema: SimilarQuestionsModelOutputSchema,
      system: SIMILAR_QUESTIONS_SYSTEM,
      prompt: buildSimilarQuestionsPrompt(input, JSON.stringify(candidates)),
    });
    const candidateById = new Map(candidates.map((candidate) => [candidate.id, candidate]));
    // 仅保留命中站内候选的 questionId：title/url 由站内数据组装，模型无法编造
    const items = modelOutput.items.flatMap((item) => {
      const candidate = candidateById.get(item.questionId);
      if (!candidate) {
        return [];
      }
      return [
        {
          questionId: candidate.id,
          title: candidate.title,
          url: `/questions/${candidate.id}`,
          reason: item.reason,
        },
      ];
    });
    const hasInSiteEvidence = items.length > 0;
    return SimilarQuestionsOutputSchema.parse({
      items,
      hasInSiteEvidence,
      note: hasInSiteEvidence ? "以下推荐基于站内历史问题检索与模型相似度排序。" : buildNoEvidenceNote("low-similarity"),
    });
  },
};
