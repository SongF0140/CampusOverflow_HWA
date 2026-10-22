// moderation_scan handler（US-13）：只做风险评估与升级判断；
// 任何处置动作（隐藏/删帖/封号）绝不在此执行，工单创建随 T-15 审批中心落地。
// G-03 工具接入：确定性模板计划执行 fetchModerationTarget 读取可见正文；
// 目标不可见或工具失败时回退请求方摘录，用户失效/撤权直接失败。
import { InternalApiError, type ModerationContentResult } from "../internal-client.js";
import { executePlan, validatePlan } from "../loop/plan-executor.js";
import { generateStructured } from "../loop/self-check.js";
import { PlanListSchema, type PlanList } from "../types/plan.js";
import { ModerationScanInputSchema, ModerationScanOutputSchema, type ModerationScanInput } from "../types/index.js";
import type { TaskContext, TaskHandler } from "./router.js";

const MODERATION_SYSTEM = `你是高校课程问答平台的内容风险评估助手。只输出风险分级、是否需要人工复核与理由；你不具有任何处置权限。`;

/** 正文计划模板：唯一合法工具、参数固定，无需模型生成 */
const buildContentPlan = (): PlanList =>
  PlanListSchema.parse({
    steps: [
      {
        stepId: "s1",
        objective: "读取待扫描内容的可见正文",
        toolName: "fetchModerationTarget",
        args: { targetType: "$input.targetType", targetId: "$input.targetId" },
      },
    ],
  });

const isAuthError = (error: unknown): boolean =>
  error instanceof InternalApiError && (error.status === 401 || error.status === 403);

/** 有正文用正文，否则明确标注依据为请求方摘录（不伪装成已核验原文） */
const buildPrompt = (input: ModerationScanInput, content: ModerationContentResult | undefined): string => {
  if (!content) {
    return `待评估内容（${input.targetType} #${input.targetId}，依据请求方提供的摘录）：\n${input.contentExcerpt}\n请给出 riskLevel、shouldEscalate 与 reason。`;
  }
  return `待评估内容（${input.targetType} #${input.targetId}）：\n标题：${content.title ?? "（无）"}\n正文：\n${content.body}\n请给出 riskLevel、shouldEscalate 与 reason。`;
};

/** 读取可见正文：无客户端时回退摘录；不可见或运行失败回退摘录；用户失效/撤权不降级 */
const loadContent = async (
  input: ModerationScanInput,
  context: TaskContext,
): Promise<ModerationContentResult | undefined> => {
  const { internalClient: client, toolRegistry } = context;
  if (!client || !toolRegistry) return undefined;
  const plan = buildContentPlan();
  validatePlan(plan, { registry: toolRegistry, requiredTools: ["fetchModerationTarget"] });
  const execution = await executePlan(plan, {
    registry: toolRegistry,
    toolContext: context.runContext,
    input,
  });
  if (execution.failures.size > 0) {
    const firstError = execution.failures.values().next().value;
    if (isAuthError(firstError)) throw firstError;
    return undefined;
  }
  const result = execution.stepResults.get("s1") as ModerationContentResult | undefined;
  return result;
};

export const moderationScanHandler: TaskHandler<ModerationScanInput> = {
  taskType: "moderation_scan",
  inputSchema: ModerationScanInputSchema,
  run: async (input, context) => {
    // TODO(T-15): shouldEscalate 为真时经 POST /internal/agent/approvals 创建待确认工单
    const content = await loadContent(input, context);
    const output = await generateStructured({
      model: context.model,
      schema: ModerationScanOutputSchema,
      system: MODERATION_SYSTEM,
      prompt: buildPrompt(input, content),
    });
    return content ? output : {
      ...output, reason: `${output.reason}（依据请求方摘录，未核验站内原文）`,
    };
  },
};
