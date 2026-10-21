// 站内标签词表工具（G-03：GET /internal/agent/user/tags，T-13 补充端点，低风险只读）
// suggest_tags 用此工具经受控计划获取词表；词表语义匹配与降级由任务层固化
import { z } from "zod";

import type { InternalClient } from "../internal-client.js";
import type { AgentTool } from "./registry.js";

const FetchTagsInputSchema = z.object({
  limit: z.number().int().min(1).max(100).default(100).describe("词表数量上限"),
});

export const createFetchTagsTool = (client: InternalClient): AgentTool => ({
  name: "fetchTags",
  description: "获取站内标签候选词表，用于标签推荐与词表匹配（只读，低风险）",
  riskLevel: "low",
  inputSchema: FetchTagsInputSchema,
  execute: async (input, context) => {
    const parsed = FetchTagsInputSchema.parse(input);
    return client.fetchTags({ limit: parsed.limit }, context.traceId);
  },
});
