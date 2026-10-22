// similar_questions handler（US-12）：模型生成受控计划执行 searchQuestions 检索站内候选，
// 再让模型挑选与解释；标题与链接一律取自站内候选组装（防模型编造），
// 无命中或无客户端时直接返回明确说明，不做模型空转
import { executePlan } from "../loop/plan-executor.js";
import { generatePlan } from "../loop/plan-generator.js";
import { generateStructured } from "../loop/self-check.js";
import { buildPlanPrompt, buildPlanningSystem, buildToolListJson } from "../prompts/planning.js";
import { buildSimilarQuestionsPrompt, SIMILAR_QUESTIONS_SYSTEM } from "../prompts/similar-questions.js";
import type { QuestionSearchResult } from "../internal-client.js";
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

/** 收集计划内所有 searchQuestions 步骤结果的并集（按 id 去重、保序） */
const collectCandidates = (
  planSteps: readonly { stepId: string; toolName: string }[],
  stepResults: ReadonlyMap<string, unknown>,
): QuestionSearchResult[] => {
  const merged = new Map<number, QuestionSearchResult>();
  for (const step of planSteps) {
    if (step.toolName !== "searchQuestions") continue;
    const result = stepResults.get(step.stepId);
    if (!Array.isArray(result)) continue;
    for (const item of result) {
      const candidate = item as QuestionSearchResult;
      if (candidate && typeof candidate.id === "number" && !merged.has(candidate.id)) {
        merged.set(candidate.id, candidate);
      }
    }
  }
  return Array.from(merged.values());
};

/** 检索计划的统一要求：至少一次 searchQuestions，参数从任务输入引用或字面量给出 */
const QUESTIONS_PLAN_REQUIREMENTS = [
  "必须包含至少一次 searchQuestions（检索站内历史问题）",
  "searchQuestions 参数：keyword（可写 $input.questionTitle 或字面量，必填）；courseId/limit 可省略或用 $input 引用",
] as const;

export const similarQuestionsHandler: TaskHandler<SimilarQuestionsInput> = {
  taskType: "similar_questions",
  inputSchema: SimilarQuestionsInputSchema,
  run: async (input, context) => {
    // 候选检索经受控计划执行（G-03：仅白名单低风险工具）；无客户端时以无依据模式运行
    const { internalClient: client, toolRegistry } = context;
    let candidates: QuestionSearchResult[] = [];
    if (client && toolRegistry) {
      const plan = await generatePlan({
        model: context.model,
        system: buildPlanningSystem("为用户的新问题检索站内相似问题"),
        prompt: buildPlanPrompt(
          `标题：${input.questionTitle}；课程 id：${input.courseId ?? "无"}；候选条数：${input.limit}`,
          buildToolListJson(toolRegistry),
          QUESTIONS_PLAN_REQUIREMENTS,
        ),
        registry: toolRegistry,
        requiredTools: ["searchQuestions"],
      });
      const execution = await executePlan(plan, {
        registry: toolRegistry,
        toolContext: context.runContext,
        input,
      });
      // 检索执行失败保持任务失败语义（明确失败，不返回"无依据"掩盖故障）
      if (execution.failures.size > 0) {
        throw execution.failures.values().next().value;
      }
      candidates = collectCandidates(plan.steps, execution.stepResults);
    }
    // 无客户端或无命中：直接给出明确说明而非空转模型（任务 T-13 完成判定）
    if (candidates.length === 0) {
      return SimilarQuestionsOutputSchema.parse({
        items: [],
        hasInSiteEvidence: false,
        note: buildNoEvidenceNote(client && toolRegistry ? "no-hits" : "client-missing"),
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
