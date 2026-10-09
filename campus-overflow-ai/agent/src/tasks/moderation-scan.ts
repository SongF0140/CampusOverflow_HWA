// moderation_scan handler（US-13）：只做风险评估与升级判断；
// 任何处置动作（隐藏/删帖/封号）绝不在此执行，工单创建随 T-15 审批中心落地
import { generateStructured } from "../loop/self-check.js";
import { ModerationScanInputSchema, ModerationScanOutputSchema, type ModerationScanInput } from "../types/index.js";
import type { TaskHandler } from "./router.js";

const MODERATION_SYSTEM = `你是高校课程问答平台的内容风险评估助手。只输出风险分级、是否需要人工复核与理由；你不具有任何处置权限。`;

export const moderationScanHandler: TaskHandler<ModerationScanInput> = {
  taskType: "moderation_scan",
  inputSchema: ModerationScanInputSchema,
  run: async (input, context) => {
    // TODO(T-15): shouldEscalate 为真时经 POST /internal/agent/approvals 创建待确认工单
    return generateStructured({
      model: context.model,
      schema: ModerationScanOutputSchema,
      system: MODERATION_SYSTEM,
      prompt: `待评估内容（${input.targetType} #${input.targetId}）：\n${input.contentExcerpt}\n请给出 riskLevel、shouldEscalate 与 reason。`,
    });
  },
};
