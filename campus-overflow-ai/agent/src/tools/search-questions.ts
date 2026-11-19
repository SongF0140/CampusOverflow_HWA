// 站内问题检索工具（plan.md §5：GET /internal/agent/questions/search，低风险只读）
// similar_questions / suggest_tags 任务复用此工具获取站内候选
// 读取路径：有夜间快照且无标签过滤时，先用快照出候选 id，再经后端候选复核接口确认可见性；
// 复核不可用、无命中或带标签名时回退原后端检索，后端始终是最终权威。
import { z } from "zod";

import type { InternalClient, QaIndexItem, UserInternalClient } from "../internal-client.js";
import type { QaSnapshot } from "../knowledge/qa-snapshot.js";
import { searchQaSnapshot } from "../knowledge/qa-snapshot.js";
import type { AgentTool } from "./registry.js";

const SearchQuestionsInputSchema = z.object({
  keyword: z.string().min(1).max(100).describe("标题或正文关键词"),
  courseId: z.number().int().positive().optional().describe("限定课程"),
  tags: z.array(z.string().min(1).max(50)).max(5).optional().describe("限定标签名"),
  limit: z.number().int().min(1).max(10).default(5).describe("返回条数上限"),
});

export interface SearchQuestionsOptions {
  /** 当前活跃问答快照；返回 undefined 表示不走快照读取 */
  getSnapshot?: () => QaSnapshot | undefined;
}

type CandidateReviewer = Pick<UserInternalClient, "fetchQaCandidates">;

const hasCandidateReview = (client: InternalClient): client is InternalClient & CandidateReviewer =>
  typeof (client as Partial<CandidateReviewer>).fetchQaCandidates === "function";

const toSearchResult = (item: QaIndexItem) => ({
  id: item.id,
  title: item.title,
  courseId: item.course_id,
  status: item.status,
});

export const createSearchQuestionsTool = (
  client: InternalClient, options: SearchQuestionsOptions = {},
): AgentTool => ({
  name: "searchQuestions",
  description: "按关键词检索站内历史问题，用于相似问题候选与上下文整理（只读，低风险）",
  riskLevel: "low",
  inputSchema: SearchQuestionsInputSchema,
  execute: async (input, context) => {
    const parsed = SearchQuestionsInputSchema.parse(input);
    const backendSearch = () => client.searchQuestions(
      { keyword: parsed.keyword, courseId: parsed.courseId, tags: parsed.tags, limit: parsed.limit },
      context.traceId,
    );

    // 快照不含标签名；带标签过滤或没有活跃快照时直接走后端
    const snapshot = options.getSnapshot?.();
    if (parsed.tags !== undefined || snapshot === undefined || !hasCandidateReview(client)) {
      return backendSearch();
    }

    const candidateIds = searchQaSnapshot(snapshot, parsed.keyword, {
      courseId: parsed.courseId,
      limit: Math.min(50, Math.max(parsed.limit * 5, parsed.limit)),
    });
    if (candidateIds.length === 0) return backendSearch();

    try {
      const reviewed = await client.fetchQaCandidates(
        { ids: candidateIds, courseId: parsed.courseId }, context.traceId,
      );
      // 候选全部不可见时回退后端，避免快照过期漏掉新问题
      return reviewed.length === 0
        ? backendSearch()
        : reviewed.slice(0, parsed.limit).map(toSearchResult);
    } catch {
      // 复核失败不阻断问答：回退后端检索，不降级为使用未复核的快照结果
      return backendSearch();
    }
  },
});
