// doc_draft handler：起草讲解文档草稿；草稿仅返回给请求方，不进入任何发布通道。
// G-03：参考问题经受控计划执行 searchQuestions 收集（仅白名单低风险工具）；
// 无客户端、无命中或普通读取失败按无参考资料起草，用户失效/撤权由执行器直接失败。
import type { QuestionSearchResult } from "../internal-client.js";
import { runPlannedTools } from "../loop/planned-tools.js";
import { generateStructured } from "../loop/self-check.js";
import {
  DocDraftInputSchema,
  DocDraftOutputSchema,
  type DocDraftInput,
} from "../types/index.js";
import type { TaskHandler } from "./router.js";

const DOC_DRAFT_SYSTEM = `你是高校课程问答平台的讲解文档起草助手，产出 Markdown 格式的讲解草稿；仅作为草稿供人工编辑，不自动发布。`;

/** 收集计划内所有 searchQuestions 步骤结果的并集（按 id 去重、保序） */
const collectReferences = (
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

const buildPrompt = (input: DocDraftInput, references: QuestionSearchResult[]): string => {
  const referenceBlock = references.length === 0
    ? "站内参考：无（请仅依据主题起草，不得编造站内链接或历史结论）。"
    : `站内参考问题（id 与标题，不得编造额外链接）：\n${references
      .map((item) => `- #${item.id} ${item.title}`)
      .join("\n")}`;
  return `主题：${input.topic}\n${referenceBlock}\n请起草一份面向本科生的讲解文档草稿，输出 title 与 bodyMarkdown。`;
};

export const docDraftHandler: TaskHandler<DocDraftInput> = {
  taskType: "doc_draft",
  inputSchema: DocDraftInputSchema,
  run: async (input, context) => {
    let references: QuestionSearchResult[] = [];
    const { internalClient: client, toolRegistry } = context;
    if (client && toolRegistry) {
      const { plan, execution } = await runPlannedTools("doc_draft", input, context);
      // 参考属辅助依据：普通读取失败按无参考起草；401/403 已在执行器终止
      if (execution.failures.size === 0) {
        references = collectReferences(plan.steps, execution.stepResults);
      }
    }
    return generateStructured({
      repairBudget: context.runContext.repairBudget,
      feedback: context.feedback,
      signal: context.runContext.signal,
      model: context.model,
      schema: DocDraftOutputSchema,
      system: DOC_DRAFT_SYSTEM,
      prompt: buildPrompt(input, references),
    });
  },
};
