import { z } from "zod";
import type { UserInternalClient } from "../internal-client.js";
import { getKnowledgeCatalog } from "../knowledge/runtime.js";
import { loadSharedContext, readCertifiedLink } from "../memory/shared-context.js";
import type { AgentTool, ToolExecutionContext } from "./registry.js";

/** 课程范围在请求边界绑定，模型不能通过工具参数换课程。 */
export const createCourseContextTools = (client: UserInternalClient, courseId: number | undefined): AgentTool[] => {
  const mainMemory: AgentTool = { name: "fetchMainMemory", description: "按需披露教学行为规范、老师已发布的课程经验和认证卡片摘要", riskLevel: "low",
    inputSchema: z.object({ level: z.enum(["summary", "detail"]), ids: z.array(z.string().max(80)).max(10) }).strict(),
    execute: (input, context) => loadSharedContext(client, courseId, context.traceId,
      z.object({ level: z.enum(["summary", "detail"]), ids: z.array(z.string()) }).parse(input)) };
  if (courseId === undefined) return [mainMemory];
  const readCatalog = async (context: ToolExecutionContext) => {
    await client.fetchTrustedTags(courseId, context.traceId);
    const catalog = getKnowledgeCatalog();
    await catalog?.refresh();
    return catalog;
  };
  return [{ name: "listKnowledgeCards", description: "读取当前课程教材领域与卡片索引，不加载摘要和正文", riskLevel: "low",
    inputSchema: z.object({}).strict(), execute: async (_input, context) =>
      (await readCatalog(context))?.list([courseId]) ?? { cards: [], configured: false } },
  { name: "fetchKnowledgeCard", description: "按索引读取当前课程卡片的领域、元数据和摘要", riskLevel: "low",
    inputSchema: z.object({ card_id: z.string().min(1).max(500) }).strict(), execute: async (input, context) => {
      const { card_id } = z.object({ card_id: z.string() }).parse(input);
      return (await readCatalog(context))?.getCard(card_id, [courseId]) ?? null;
    } },
  { name: "fetchKnowledgeBody", description: "在选定卡片和版本下按书签展开正文，版本变化须重新读取索引", riskLevel: "low",
    inputSchema: z.object({ card_id: z.string().min(1).max(500), version: z.string().regex(/^[a-f0-9]{64}$/) }).strict(),
    execute: async (input, context) => {
      const parsed = z.object({ card_id: z.string(), version: z.string() }).parse(input);
      return await (await readCatalog(context))?.getBody(parsed.card_id, [courseId], parsed.version) ?? null;
    } },
  mainMemory,
  { name: "fetchCertifiedAnswer", description: "命中适用的认证卡片后回源核验并返回真实问答链接，不能生成认证正文", riskLevel: "low",
    inputSchema: z.object({ card_id: z.string().min(1).max(80) }).strict(), execute: (input, context) =>
      readCertifiedLink(client, courseId, z.object({ card_id: z.string() }).parse(input).card_id, context.traceId) }];
};
