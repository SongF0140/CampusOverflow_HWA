// doc_draft handler：起草讲解文档草稿；草稿仅返回给请求方，不进入任何发布通道。
// G-03 工具接入：确定性模板计划执行 searchQuestions 收集站内相关历史问题作为参考；
// 无客户端、无命中或检索失败时按无参考资料起草，用户失效/撤权直接失败。
import { InternalApiError, type QuestionSearchResult } from "../internal-client.js";
import { executePlan, validatePlan } from "../loop/plan-executor.js";
import { generateStructured } from "../loop/self-check.js";
import { PlanListSchema, type PlanList } from "../types/plan.js";
import { DocDraftInputSchema, DocDraftOutputSchema, type DocDraftInput } from "../types/index.js";
import type { TaskContext, TaskHandler } from "./router.js";

const DOC_DRAFT_SYSTEM = `你是高校课程问答平台的讲解文档起草助手，产出 Markdown 格式的讲解草稿；仅作为草稿供人工编辑，不自动发布。`;

/** 参考问题条数：与 searchQuestions 工具默认上限对齐 */
const REFERENCE_LIMIT = 5;

/** 参考计划模板：唯一合法工具、参数由任务输入确定性构造，无需模型生成 */
const buildReferencePlan = (input: DocDraftInput): PlanList => {
  const args: Record<string, unknown> = {
    keyword: input.topic.slice(0, 100),
    limit: REFERENCE_LIMIT,
  };
  if (input.courseId !== undefined) args.courseId = input.courseId;
  return PlanListSchema.parse({
    steps: [
      { stepId: "s1", objective: "检索站内相关历史问题作为起草参考", toolName: "searchQuestions", args },
    ],
  });
};

const isAuthError = (error: unknown): boolean =>
  error instanceof InternalApiError && (error.status === 401 || error.status === 403);

/** 收集站内参考：无客户端时为空；不可见或运行失败按无参考处理；用户失效/撤权不降级 */
const loadReferences = async (
  input: DocDraftInput,
  context: TaskContext,
): Promise<QuestionSearchResult[]> => {
  const { internalClient: client, toolRegistry } = context;
  if (!client || !toolRegistry) return [];
  const plan = buildReferencePlan(input);
  validatePlan(plan, { registry: toolRegistry, requiredTools: ["searchQuestions"] });
  const execution = await executePlan(plan, {
    registry: toolRegistry,
    toolContext: context.runContext,
    input,
  });
  if (execution.failures.size > 0) {
    const firstError = execution.failures.values().next().value;
    if (isAuthError(firstError)) throw firstError;
    return [];
  }
  const result = execution.stepResults.get("s1");
  return Array.isArray(result) ? (result as QuestionSearchResult[]) : [];
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
