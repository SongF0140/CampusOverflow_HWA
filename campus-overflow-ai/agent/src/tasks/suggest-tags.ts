// suggest_tags handler（US-11/E-09）：只产出建议与置信度，写入由用户确认后经后端标签绑定接口完成
// 词表来源（G-03 接入）：确定性模板计划执行 fetchTags 工具（仅白名单低风险只读）；
// 工具链无决策空间（唯一合法工具、参数固定），不走模型生成，保证权限失效时零模型调用；
// 缺客户端或计划执行失败时降级为纯文本语义匹配，basisNote 原样明确依据（E-09/T-13）。
import { InternalApiError, type TagVocabularyItem } from "../internal-client.js";
import { executePlan, validatePlan } from "../loop/plan-executor.js";
import { generateStructured } from "../loop/self-check.js";
import { buildSuggestTagsPrompt, SUGGEST_TAGS_SYSTEM } from "../prompts/suggest-tags.js";
import { PlanListSchema, type PlanList } from "../types/plan.js";
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

/** 词表拉取上限：与后端 GET /internal/agent/user/tags 默认 limit 对齐 */
const TAG_VOCABULARY_LIMIT = 100;

/** 收集计划内所有 fetchTags 步骤结果的并集（按 id 去重、保序） */
const collectVocabulary = (
  planSteps: readonly { stepId: string; toolName: string }[],
  stepResults: ReadonlyMap<string, unknown>,
): TagVocabularyItem[] => {
  const merged = new Map<number, TagVocabularyItem>();
  for (const step of planSteps) {
    if (step.toolName !== "fetchTags") continue;
    const result = stepResults.get(step.stepId);
    if (!Array.isArray(result)) continue;
    for (const item of result) {
      const tag = item as TagVocabularyItem;
      if (tag && typeof tag.id === "number" && !merged.has(tag.id)) merged.set(tag.id, tag);
    }
  }
  return Array.from(merged.values());
};

/** 词表计划模板：确定性工具链（唯一合法工具、参数固定），经 validatePlan 校验后执行 */
const buildTagsPlan = (): PlanList =>
  PlanListSchema.parse({
    steps: [
      { stepId: "s1", objective: "获取站内标签词表", toolName: "fetchTags", args: { limit: TAG_VOCABULARY_LIMIT } },
    ],
  });

export const suggestTagsHandler: TaskHandler<SuggestTagsInput> = {
  taskType: "suggest_tags",
  inputSchema: SuggestTagsInputSchema,
  run: async (input, context) => {
    // G-03：词表经受控计划执行（仅白名单低风险工具）；无客户端时降级为空词表运行，不阻塞推荐
    let vocabulary: TagVocabularyItem[] = [];
    const { internalClient: client, toolRegistry } = context;
    if (client && toolRegistry) {
      const plan = buildTagsPlan();
      validatePlan(plan, { registry: toolRegistry, requiredTools: ["fetchTags"] });
      const execution = await executePlan(plan, {
        registry: toolRegistry,
        toolContext: {
          principal: context.runContext.principal,
          agentRunId: context.runContext.agentRunId,
          traceId: context.runContext.traceId,
        },
        input,
      });
      if (execution.failures.size > 0) {
        // 用户失效或被撤权不能降级为仍可执行的语义推荐。
        const firstError = execution.failures.values().next().value;
        if (firstError instanceof InternalApiError && (firstError.status === 401 || firstError.status === 403)) {
          throw firstError;
        }
        vocabulary = [];
      } else {
        vocabulary = collectVocabulary(plan.steps, execution.stepResults);
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
