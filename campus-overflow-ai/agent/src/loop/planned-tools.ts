import type { LanguageModel } from "ai";

import type { RunContext, RunTaskKind } from "../observability/run-context.js";
import { buildPlanPrompt, buildPlanningSystem, buildToolListJson } from "../prompts/planning.js";
import { createToolRegistry, type ToolRegistry } from "../tools/registry.js";
import { executePlan, PlanExecutionError } from "./plan-executor.js";
import { generatePlan } from "./plan-generator.js";

const READ_TOOLS = ["searchCourses", "searchQuestions", "fetchTags", "fetchModerationTarget"] as const;
const TASK_TOOLS: Record<RunTaskKind, readonly string[]> = {
  chat: READ_TOOLS,
  suggest_tags: ["fetchTags"],
  similar_questions: ["searchCourses", "searchQuestions"],
  doc_draft: ["searchCourses", "searchQuestions"],
  moderation_scan: ["fetchModerationTarget"],
};
const REQUIRED_TOOLS: Record<RunTaskKind, readonly string[]> = {
  chat: [], suggest_tags: ["fetchTags"], similar_questions: ["searchQuestions"],
  doc_draft: ["searchQuestions"], moderation_scan: ["fetchModerationTarget"],
};
const TASK_HINTS: Record<RunTaskKind, string> = {
  chat: "回答用户的课程学习问题，按需检索站内资料",
  suggest_tags: "检索词表，为用户的问题推荐标签",
  similar_questions: "为用户的问题检索站内相似问题",
  doc_draft: "为课程讲解草稿收集站内参考问题",
  moderation_scan: "读取请求指定的正文，为内容风险评估提供依据",
};

interface PlanningContext {
  model: LanguageModel;
  runContext: RunContext;
  toolRegistry?: ToolRegistry;
}

/** 任务范围由服务端输入确定，模型不能通过省略或改写参数扩大查询。 */
const assertTaskScope = (
  kind: RunTaskKind, input: Record<string, unknown>, tool: string, args: Readonly<Record<string, unknown>>,
): void => {
  if ((kind === "doc_draft" || kind === "similar_questions") && tool === "searchQuestions"
    && input.courseId !== undefined && args.courseId !== input.courseId) {
    throw new PlanExecutionError("检索计划必须保留请求指定的课程范围");
  }
  if (kind === "moderation_scan" && tool === "fetchModerationTarget"
    && (args.targetType !== input.targetType || args.targetId !== input.targetId)) {
    throw new PlanExecutionError("扫描计划必须保持请求指定的内容目标");
  }
};

/** 所有生产入口共用模型规划、任务工具裁剪及运行预算；这里只执行工具，不生成最终回答。 */
export const runPlannedTools = async (
  kind: RunTaskKind,
  input: Record<string, unknown>,
  context: PlanningContext,
) => {
  if (!context.toolRegistry) throw new PlanExecutionError("缺少请求级工具注册表");
  const registry = createToolRegistry();
  for (const tool of context.toolRegistry.listTools()) {
    if (TASK_TOOLS[kind].includes(tool.name) && tool.execute && tool.riskLevel === "low") registry.registerTool(tool);
  }
  const requiredTools = REQUIRED_TOOLS[kind];
  const plan = await generatePlan({
    model: context.model, registry, requiredTools,
    system: buildPlanningSystem(TASK_HINTS[kind]),
    prompt: buildPlanPrompt(JSON.stringify(input), buildToolListJson(registry), [
      ...requiredTools.map((name) => `必须包含至少一次 ${name}`),
      "输入有 courseId 时，searchQuestions 必须保留该 courseId（可用 $input.courseId）",
      "moderation_scan 必须用原 targetType/targetId，可引用 $input.targetType/$input.targetId",
      "关键词须符合工具长度约束，可提炼输入关键词；不得改变任务指定的课程或目标",
    ]),
  });
  const execution = await executePlan(plan, {
    registry, input, toolContext: context.runContext, requiredTools,
    assertArgs: (tool, args) => assertTaskScope(kind, input, tool, args),
  });
  return { plan, execution };
};
