// searchQuestions 读取路径：快照只出候选 id，后端复核通过后才返回；异常一律回退后端检索。
import { describe, expect, it, vi } from "vitest";

import type { InternalClient, QaIndexItem, QuestionSearchResult } from "../src/internal-client.js";
import type { QaSnapshot } from "../src/knowledge/qa-snapshot.js";
import type { ToolExecutionContext } from "../src/tools/registry.js";
import { createSearchQuestionsTool } from "../src/tools/search-questions.js";
import { asAgentRunId, asTraceId } from "../src/types/index.js";

const trace = asTraceId("search-snapshot");
const context = {
  agentRunId: asAgentRunId("search-snapshot-run"), traceId: trace,
} as unknown as ToolExecutionContext;

const item = (id: number, title: string, courseId = 1): QaIndexItem => ({
  id, title, course_id: courseId, status: "published", tag_ids: [],
  updated_at: "2026-11-01T00:00:00",
});

const snapshotOf = (items: QaIndexItem[]): QaSnapshot => ({
  version: "v1", items, byId: new Map(items.map(entry => [entry.id, entry])),
});

const backendResult: QuestionSearchResult = {
  id: 99, title: "后端候选", courseId: 1, status: "published",
};

const clientOf = (review?: (ids: number[]) => Promise<QaIndexItem[]>) => {
  const searchQuestions = vi.fn(async (): Promise<QuestionSearchResult[]> => [backendResult]);
  const fetchQaCandidates = vi.fn(async ({ ids }: { ids: number[] }) =>
    review ? review(ids) : ids.map(id => item(id, `复核${id}`)));
  return {
    client: { searchQuestions, fetchQaCandidates } as unknown as InternalClient,
    searchQuestions,
    fetchQaCandidates,
  };
};

describe("searchQuestions 快照读取", () => {
  it("有快照时先出候选 id 再经后端复核，不直连后端检索", async () => {
    const { client, searchQuestions, fetchQaCandidates } = clientOf();
    const tool = createSearchQuestionsTool(client, {
      getSnapshot: () => snapshotOf([item(1, "Java 闭包")]),
    });

    const result = await tool.execute!({ keyword: "闭包", limit: 3 }, context);

    expect(fetchQaCandidates).toHaveBeenCalledWith({ ids: [1], courseId: undefined }, trace);
    expect(searchQuestions).not.toHaveBeenCalled();
    expect(result).toEqual([{ id: 1, title: "复核1", courseId: 1, status: "published" }]);
  });

  it("限定课程的候选只提交同课程问题并带上课程参数", async () => {
    const { client, fetchQaCandidates } = clientOf();
    const tool = createSearchQuestionsTool(client, {
      getSnapshot: () => snapshotOf([
        item(1, "TCP 三次握手", 1), item(2, "TCP 拥塞控制", 2),
      ]),
    });

    await tool.execute!({ keyword: "TCP", courseId: 2 }, context);

    expect(fetchQaCandidates).toHaveBeenCalledWith({ ids: [2], courseId: 2 }, trace);
  });

  it("带标签过滤时直接走后端，不使用快照", async () => {
    const { client, searchQuestions, fetchQaCandidates } = clientOf();
    const tool = createSearchQuestionsTool(client, {
      getSnapshot: () => snapshotOf([item(1, "Java 闭包")]),
    });

    const result = await tool.execute!({ keyword: "闭包", tags: ["Java"] }, context);

    expect(fetchQaCandidates).not.toHaveBeenCalled();
    expect(searchQuestions).toHaveBeenCalledTimes(1);
    expect(result).toEqual([backendResult]);
  });

  it("复核结果为空或复核失败时回退后端检索", async () => {
    const empty = clientOf(async () => []);
    const emptyTool = createSearchQuestionsTool(empty.client, {
      getSnapshot: () => snapshotOf([item(1, "Java 闭包")]),
    });
    expect(await emptyTool.execute!({ keyword: "闭包" }, context)).toEqual([backendResult]);
    expect(empty.searchQuestions).toHaveBeenCalledTimes(1);

    const failing = clientOf(async () => { throw new Error("review down"); });
    const failingTool = createSearchQuestionsTool(failing.client, {
      getSnapshot: () => snapshotOf([item(1, "Java 闭包")]),
    });
    expect(await failingTool.execute!({ keyword: "闭包" }, context)).toEqual([backendResult]);
    expect(failing.searchQuestions).toHaveBeenCalledTimes(1);
  });

  it("没有活跃快照或无命中时回退后端", async () => {
    const noSnapshot = clientOf();
    const noSnapshotTool = createSearchQuestionsTool(noSnapshot.client, {
      getSnapshot: () => undefined,
    });
    expect(await noSnapshotTool.execute!({ keyword: "闭包" }, context)).toEqual([backendResult]);
    expect(noSnapshot.fetchQaCandidates).not.toHaveBeenCalled();

    const noMatch = clientOf();
    const noMatchTool = createSearchQuestionsTool(noMatch.client, {
      getSnapshot: () => snapshotOf([item(1, "Java 闭包")]),
    });
    expect(await noMatchTool.execute!({ keyword: "数据库索引" }, context)).toEqual([backendResult]);
    expect(noMatch.fetchQaCandidates).not.toHaveBeenCalled();
  });

  it("返回条数不超过工具上限", async () => {
    const { client } = clientOf(async ids => ids.map(id => item(id, `复核${id}`)));
    const tool = createSearchQuestionsTool(client, {
      getSnapshot: () => snapshotOf([1, 2, 3, 4].map(id => item(id, `Java 问题${id}`))),
    });

    const result = await tool.execute!({ keyword: "Java", limit: 2 }, context);

    expect(result).toHaveLength(2);
  });
});
