// doc_draft handler：起草讲解文档草稿；草稿仅返回给请求方，不进入任何发布通道。
// 统一模型计划通过 searchQuestions 收集站内相关历史问题作为参考；
// 无客户端、无命中或检索失败时按无参考资料起草，用户失效/撤权直接失败。
import type { QuestionSearchResult } from "../internal-client.js";
import { runPlannedTools } from "../loop/planned-tools.js";
import { generateStructured } from "../loop/self-check.js";
import { DocDraftInputSchema, DocDraftOutputSchema, type DocDraftInput } from "../types/index.js";
import type { TaskContext, TaskHandler } from "./router.js";

const DOC_DRAFT_SYSTEM = `你是高校课程问答平台的讲解文档起草助手，产出 Markdown 格式的讲解草稿；仅作为草稿供人工编辑，不自动发布。`;

/** 收集站内参考：无客户端时为空；不可见或运行失败按无参考处理；用户失效/撤权不降级 */
const loadReferences = async (
  input: DocDraftInput,
  context: TaskContext,
): Promise<QuestionSearchResult[]> => {
  const { internalClient: client, toolRegistry } = context;
  if (!client || !toolRegistry) return [];
  const { plan, execution } = await runPlannedTools("doc_draft", input, context);
  if (execution.failures.size > 0) {
    return [];
  }
  const references = plan.steps.filter((step) => step.toolName === "searchQuestions").flatMap((step) => {
    const result = execution.stepResults.get(step.stepId);
    return Array.isArray(result) ? result as QuestionSearchResult[] : [];
  });
  return Array.from(new Map(references.map((item) => [item.id, item])).values());
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
    const references = await loadReferences(input, context);
    return generateStructured({
      model: context.model,
      schema: DocDraftOutputSchema,
      system: DOC_DRAFT_SYSTEM,
      prompt: buildPrompt(input, references),
    });
  },
};
