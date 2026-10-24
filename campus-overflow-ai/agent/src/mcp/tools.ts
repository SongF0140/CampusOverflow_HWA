// MCP 只读工具集（T-17 N-01，Q-11①）：大系统信息同步的查询面。
// 全部经既有 service 级 internal-client 只读方法取数（C-05：MCP 层零 SQL）；
// 本批全 scope=read；管理员工具（admin:*）后续批次经审批工单通道接入。
import { z } from "zod";

import type { InternalClient } from "../internal-client.js";
import { asTraceId } from "../types/index.js";
import {
  McpToolRegistry,
  zodValidator,
  type McpToolDefinition,
} from "./registry.js";

const KeywordSchema = z.string().min(1).max(100);
const LimitSchema = z.number().int().min(1).max(50).default(10);

const searchQuestionsTool = (client: InternalClient): McpToolDefinition => ({
  name: "search_questions",
  description: "按关键词检索站内问答（标题或正文），用于外部系统同步站内问答信息",
  scope: "read",
  inputSchema: {
    type: "object",
    properties: {
      keyword: { type: "string", minLength: 1, maxLength: 100, description: "关键词" },
      limit: { type: "integer", minimum: 1, maximum: 50, default: 10, description: "返回条数上限" },
    },
    required: ["keyword"],
    additionalProperties: false,
  },
  validate: zodValidator(z.object({ keyword: KeywordSchema, limit: LimitSchema })),
  execute: async (args, ctx) => {
    const parsed = args as { keyword: string; limit: number };
    return client.searchQuestions(
      { keyword: parsed.keyword, limit: parsed.limit }, asTraceId(ctx.traceId),
    );
  },
});

const searchCoursesTool = (client: InternalClient): McpToolDefinition => ({
  name: "search_courses",
  description: "按关键词检索站内课程（名称或编码），用于外部系统同步课程目录",
  scope: "read",
  inputSchema: {
    type: "object",
    properties: {
      keyword: { type: "string", minLength: 1, maxLength: 50, description: "关键词" },
      limit: { type: "integer", minimum: 1, maximum: 50, default: 10, description: "返回条数上限" },
    },
    required: ["keyword"],
    additionalProperties: false,
  },
  validate: zodValidator(z.object({ keyword: KeywordSchema, limit: LimitSchema })),
  execute: async (args, ctx) => {
    const parsed = args as { keyword: string; limit: number };
    return client.searchCourses({ keyword: parsed.keyword, limit: parsed.limit }, asTraceId(ctx.traceId));
  },
});

const listTagsTool = (client: InternalClient): McpToolDefinition => ({
  name: "list_tags",
  description: "获取站内标签词表，用于外部系统同步标签体系",
  scope: "read",
  inputSchema: {
    type: "object",
    properties: {
      limit: { type: "integer", minimum: 1, maximum: 100, default: 50, description: "返回条数上限" },
    },
    additionalProperties: false,
  },
  validate: zodValidator(z.object({ limit: z.number().int().min(1).max(100).default(50) })),
  execute: async (args, ctx) => {
    const parsed = args as { limit: number };
    return client.fetchTags({ limit: parsed.limit }, asTraceId(ctx.traceId));
  },
});

/** 装配全部只读工具；幂等可重复调用（重复注册即抛错，调用方持有独立注册表） */
export const ensureReadOnlyMcpTools = (
  registry: McpToolRegistry, client: InternalClient,
): void => {
  for (const tool of [
    searchQuestionsTool(client),
    searchCoursesTool(client),
    listTagsTool(client),
  ]) {
    registry.registerTool(tool);
  }
};
