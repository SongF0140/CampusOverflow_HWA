// 课程知识树读取工具（K-03：GET /internal/agent/[user/]courses/{id}/knowledge-tree，只读低风险）
// knowledge_tree 大纲分析任务用此工具读取现有树，避免建议与既有知识点重复
import { z } from "zod";

import type { InternalClient } from "../internal-client.js";
import type { AgentTool } from "./registry.js";

const FetchKnowledgeTreeInputSchema = z.object({
  courseId: z.number().int().positive().describe("课程 ID"),
});

export const createFetchKnowledgeTreeTool = (client: InternalClient): AgentTool => ({
  name: "fetchKnowledgeTree",
  description: "读取课程知识树的现有知识点清单，用于大纲分析时避免重复建议（只读，低风险）",
  riskLevel: "low",
  inputSchema: FetchKnowledgeTreeInputSchema,
  execute: async (input, context) => {
    const parsed = FetchKnowledgeTreeInputSchema.parse(input);
    return client.fetchKnowledgeTree({ courseId: parsed.courseId }, context.traceId);
  },
});
