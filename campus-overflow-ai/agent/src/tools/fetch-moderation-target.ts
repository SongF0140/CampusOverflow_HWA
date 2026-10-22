// 治理目标正文读取工具（US-13：GET /internal/agent/user/moderation-targets，低风险只读）
// 仅返回可见内容；不存在/已软删/已隐藏由后端统一 404，工具不做任何处置
import { z } from "zod";

import type { InternalClient } from "../internal-client.js";
import type { AgentTool } from "./registry.js";

const FetchModerationTargetInputSchema = z.object({
  targetType: z.enum(["question", "answer", "comment"]).describe("治理目标类型"),
  targetId: z.number().int().positive().describe("治理目标 id"),
});

export const createFetchModerationTargetTool = (client: InternalClient): AgentTool => ({
  name: "fetchModerationTarget",
  description: "按类型与 id 读取待审核内容的可见正文，用于内容风险扫描（只读，低风险）",
  riskLevel: "low",
  inputSchema: FetchModerationTargetInputSchema,
  execute: async (input, context) => {
    const parsed = FetchModerationTargetInputSchema.parse(input);
    return client.fetchModerationTarget(
      { targetType: parsed.targetType, targetId: parsed.targetId },
      context.traceId,
    );
  },
});
