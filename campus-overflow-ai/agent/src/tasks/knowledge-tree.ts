// knowledge_tree handler（KN-R01，Q-09①）：教材大纲 → 知识点建议。
// 只产出建议，写入须教师确认后经后端知识树接口完成（E-17）；
// 现有树经受控计划读取，与既有知识点重复的建议由程序剔除并在 notes 说明。
import type { KnowledgeTreeNodeItem } from "../internal-client.js";
import { runPlannedTools } from "../loop/planned-tools.js";
import { generateStructured } from "../loop/self-check.js";
import {
  buildKnowledgeTreePrompt,
  KNOWLEDGE_TREE_SYSTEM,
} from "../prompts/knowledge-tree.js";
import {
  KnowledgeTreeInputSchema,
  KnowledgeTreeModelOutputSchema,
  KnowledgeTreeOutputSchema,
  type KnowledgeTreeInput,
  type KnowledgeTreeOutput,
} from "../types/index.js";
import type { TaskHandler } from "./router.js";

export const NO_TREE_BASIS_NOTE = "未读取到现有知识树，建议未经重复过滤，确认写入时后端仍会拒绝重复知识点。";
export const NO_FILTER_NOTE = "建议均不与现有知识树重复，经教师确认后写入。";

/** 收集计划内所有 fetchKnowledgeTree 步骤结果的并集（按 id 去重、保序） */
const collectExistingNodes = (
  planSteps: readonly { stepId: string; toolName: string }[],
  stepResults: ReadonlyMap<string, unknown>,
): KnowledgeTreeNodeItem[] => {
  const merged = new Map<number, KnowledgeTreeNodeItem>();
  for (const step of planSteps) {
    if (step.toolName !== "fetchKnowledgeTree") continue;
    const result = stepResults.get(step.stepId);
    if (!Array.isArray(result)) continue;
    for (const item of result) {
      const node = item as KnowledgeTreeNodeItem;
      if (node && typeof node.id === "number" && !merged.has(node.id)) merged.set(node.id, node);
    }
  }
  return Array.from(merged.values());
};

export const knowledgeTreeHandler: TaskHandler<KnowledgeTreeInput> = {
  taskType: "knowledge_tree",
  inputSchema: KnowledgeTreeInputSchema,
  run: async (input, context) => {
    // 现有树经受控计划读取（仅 fetchKnowledgeTree 白名单）；读取失败不阻塞首次建树的建议产出
    let existingNodes: KnowledgeTreeNodeItem[] = [];
    const { internalClient: client, toolRegistry } = context;
    if (client && toolRegistry) {
      const { plan, execution } = await runPlannedTools("knowledge_tree", input, context);
      if (execution.failures.size === 0) {
        existingNodes = collectExistingNodes(plan.steps, execution.stepResults);
      }
    }
    const modelOutput = await generateStructured({
      repairBudget: context.runContext.repairBudget,
      feedback: context.feedback,
      signal: context.runContext.signal,
      model: context.model,
      schema: KnowledgeTreeModelOutputSchema,
      system: KNOWLEDGE_TREE_SYSTEM,
      prompt: buildKnowledgeTreePrompt(
        input,
        existingNodes.map((node) => node.name),
      ),
    });
    // 程序过滤：与现有树重复（去空白比较）或彼此重复的建议剔除，不信任模型自律
    const existingKeys = new Set(existingNodes.map((node) => node.name.trim()));
    const seen = new Set<string>();
    const nodes: KnowledgeTreeOutput["nodes"] = [];
    let filtered = 0;
    for (const candidate of modelOutput.nodes) {
      const key = candidate.name.trim();
      if (!key || existingKeys.has(key) || seen.has(key)) {
        filtered += 1;
        continue;
      }
      seen.add(key);
      nodes.push({ name: key, reason: candidate.reason });
    }
    const notes = existingNodes.length === 0
      ? NO_TREE_BASIS_NOTE
      : filtered > 0
        ? `已剔除 ${filtered} 个与现有知识树或彼此重复的建议，其余建议经教师确认后写入。`
        : NO_FILTER_NOTE;
    return KnowledgeTreeOutputSchema.parse({ nodes, notes });
  },
};
