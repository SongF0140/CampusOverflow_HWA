// 站内问题检索工具（plan.md §5：GET /internal/agent/questions/search，低风险只读）
// similar_questions / suggest_tags 任务复用此工具获取站内候选
import { z } from "zod";

import type { InternalClient } from "../internal-client.js";
import type { AgentTool } from "./registry.js";

const SearchQuestionsInputSchema = z.object({
  keyword: z.string().min(1).max(100).describe("标题或正文关键词"),
  courseId: z.number().int().positive().optional().describe("限定课程"),
  tags: z.array(z.string().min(1).max(50)).max(5).optional().describe("限定标签名"),
  limit: z.number().int().min(1).max(10).default(5).describe("返回条数上限"),
});

export const createSearchQuestionsTool = (client: InternalClient): AgentTool => ({
  name: "searchQuestions",
  description: "按关键词检索站内历史问题，用于相似问题候选与上下文整理（只读，低风险）",
  riskLevel: "low",
  inputSchema: SearchQuestionsInputSchema,
  execute: async (input, context) => {
    const parsed = SearchQuestionsInputSchema.parse(input);
    return client.searchQuestions(
      { keyword: parsed.keyword, courseId: parsed.courseId, tags: parsed.tags, limit: parsed.limit },
      context.traceId,
    );
  },
});
