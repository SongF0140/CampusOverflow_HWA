// 站内课程检索工具（plan.md §5：GET /internal/agent/courses/search，低风险只读）
import { z } from "zod";

import type { InternalClient } from "../internal-client.js";
import type { AgentTool } from "./registry.js";

const SearchCoursesInputSchema = z.object({
  keyword: z.string().min(1).max(100).describe("课程名称或编号关键词"),
  limit: z.number().int().min(1).max(20).default(5).describe("返回条数上限"),
});

export const createSearchCoursesTool = (client: InternalClient): AgentTool => ({
  name: "searchCourses",
  description: "按关键词检索站内课程，用于获取课程上下文（只读，低风险）",
  riskLevel: "low",
  inputSchema: SearchCoursesInputSchema,
  execute: async (input, context) => {
    // AI SDK 已按 inputSchema 校验模型入参，这里复用同一 schema 收敛类型
    const parsed = SearchCoursesInputSchema.parse(input);
    return client.searchCourses({ keyword: parsed.keyword, limit: parsed.limit }, context.traceId);
  },
});
