/** 课程教材 RAG 只读工具：课程在请求边界绑定，模型不能通过参数换课程。 */

import { z } from "zod";

import type { RagIndex } from "../knowledge/rag/index.js";
import type { AgentTool, ToolExecutionContext } from "./registry.js";

const SearchKnowledgeInputSchema = z.object({
  query: z.string().min(1).max(200).describe("要检索的课程问题或关键词"),
  limit: z.number().int().min(1).max(5).default(3).describe("返回片段数上限"),
}).strict();

export interface SearchKnowledgeOutput {
  configured: boolean;
  hits: {
    chunk_id: string;
    card_id: string;
    kind: "summary" | "body";
    title?: string;
    text: string;
    score: number;
  }[];
  degraded?: boolean;
}

export const createSearchKnowledgeTool = (
  getIndex: (courseId: number) => Promise<RagIndex | undefined>,
  courseId: number,
  verifyAccess?: (context: ToolExecutionContext) => Promise<unknown>,
): AgentTool => ({
  name: "searchKnowledge",
  description: "检索当前课程教材的摘要与正文片段，返回卡片 id、标题与原文片段，用于回答前取证（只读，低风险）",
  riskLevel: "low",
  inputSchema: SearchKnowledgeInputSchema,
  execute: async (input, context): Promise<SearchKnowledgeOutput> => {
    const parsed = SearchKnowledgeInputSchema.parse(input);
    // 课程 ID 来自请求边界；先用用户凭证确认课程资料权限，再构建/读取索引。
    if (verifyAccess) await verifyAccess(context);
    let index: RagIndex | undefined;
    try {
      index = await getIndex(courseId);
    } catch (error) {
      console.error(JSON.stringify({
        event: "rag_tool_index_failed",
        course_id: courseId,
        reason: (error instanceof Error ? error.message : String(error)).replace(/\s+/g, " ").slice(0, 200),
      }));
      return { configured: false, hits: [], degraded: true };
    }
    if (!index) return { configured: false, hits: [] };
    try {
      const result = await index.search(parsed.query, {
        topK: parsed.limit,
        topN: 20,
        courseId,
      });
      return {
        configured: true,
        hits: result.hits.map(hit => ({
          chunk_id: hit.chunkId,
          card_id: hit.cardId,
          kind: hit.kind,
          title: hit.title,
          text: hit.text.slice(0, 800),
          score: Number(hit.score.toFixed(6)),
        })),
      };
    } catch (error) {
      console.error(JSON.stringify({
        event: "rag_tool_search_failed",
        course_id: courseId,
        reason: (error instanceof Error ? error.message : String(error)).replace(/\s+/g, " ").slice(0, 200),
      }));
      // 教材检索失败不阻断问答：返回空结果，模型可回退课程卡片或普通问答。
      return { configured: true, hits: [], degraded: true };
    }
  },
});
