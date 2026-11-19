// 问答快照：游标拉取、条数上限、版本稳定；双槽切换与回退。
import { describe, expect, it, vi } from "vitest";

import type { QaIndexItem, UserInternalClient } from "../src/internal-client.js";
import {
  buildQaSnapshot, createQaSnapshotSlots, searchQaSnapshot,
} from "../src/knowledge/qa-snapshot.js";
import { asTraceId } from "../src/types/index.js";

const item = (id: number): QaIndexItem => ({
  id, title: `问题${id}`, course_id: 1, status: "published",
  tag_ids: [], updated_at: "2026-11-01T00:00:00",
});

const clientOf = (pages: Record<number, { items: QaIndexItem[]; next_cursor: number | null }>) => ({
  fetchQaIndexSnapshot: vi.fn(async ({ cursor }: { cursor: number }) => pages[cursor]),
} as unknown as UserInternalClient);

const trace = asTraceId("trace-qa");

describe("问答快照构建", () => {
  it("按游标拉取全部分页并生成稳定版本", async () => {
    const client = clientOf({
      0: { items: [item(1), item(2)], next_cursor: 2 },
      2: { items: [item(3)], next_cursor: null },
    });
    const snapshot = await buildQaSnapshot(client, trace);
    expect(snapshot.items.map(entry => entry.id)).toEqual([1, 2, 3]);
    expect(snapshot.byId.get(3)?.title).toBe("问题3");
    expect(snapshot.version).toMatch(/^[a-f0-9]{16}$/);

    const again = await buildQaSnapshot(client, trace);
    expect(again.version).toBe(snapshot.version);
  });

  it("达到条数上限后停止拉取", async () => {
    const client = clientOf({
      0: { items: [item(1), item(2)], next_cursor: 2 },
      2: { items: [item(3), item(4)], next_cursor: null },
    });
    const snapshot = await buildQaSnapshot(client, trace, { maxItems: 3 });
    expect(snapshot.items).toHaveLength(3);
    expect(client.fetchQaIndexSnapshot).toHaveBeenCalledTimes(2);
  });

  it("游标不前进时报错，避免死循环", async () => {
    const client = clientOf({
      0: { items: [item(1)], next_cursor: 1 },
      1: { items: [item(2)], next_cursor: 1 },
    });
    await expect(buildQaSnapshot(client, trace)).rejects.toThrow("qa_snapshot_cursor_stalled");
  });
});

describe("问答快照双槽", () => {
  it("stage 不切活跃，promote 切换并保留旧槽，rollback 恢复", async () => {
    const slots = createQaSnapshotSlots();
    const client = clientOf({ 0: { items: [item(1)], next_cursor: null } });
    const first = await buildQaSnapshot(client, trace);
    slots.stage(first);
    expect(slots.info().active).toBeNull();
    slots.promote();
    expect(slots.info().active?.version).toBe(first.version);

    const secondClient = clientOf({ 0: { items: [item(1), item(2)], next_cursor: null } });
    const second = await buildQaSnapshot(secondClient, trace);
    slots.stage(second);
    slots.promote();
    expect(slots.info().active?.items).toBe(2);
    expect(slots.info().previous?.version).toBe(first.version);

    slots.rollback();
    expect(slots.info().active?.version).toBe(first.version);
  });

  it("旧槽过期后不可回退", async () => {
    const slots = createQaSnapshotSlots(-1);
    const client = clientOf({ 0: { items: [item(1)], next_cursor: null } });
    const first = await buildQaSnapshot(client, trace);
    slots.stage(first);
    slots.promote();

    const second = await buildQaSnapshot(client, trace);
    slots.stage(second);
    slots.promote();
    expect(() => slots.rollback()).toThrow("问答旧快照已过期");
  });

  it("旧槽到期后访问槽信息即清理", async () => {
    let now = 1_000;
    const slots = createQaSnapshotSlots(100, () => now);
    const client = clientOf({ 0: { items: [item(1)], next_cursor: null } });
    const first = await buildQaSnapshot(client, trace);
    slots.stage(first);
    slots.promote();

    const second = await buildQaSnapshot(client, trace);
    slots.stage(second);
    slots.promote();
    expect(slots.info().previous).not.toBeNull();

    now = 1_200;
    expect(slots.info().previous).toBeNull();
    expect(() => slots.rollback()).toThrow("没有可回退的问答快照");
  });
});

describe("快照候选检索", () => {
  const entries = [item(1), item(2), item(3), item(4)];
  const titles = ["TCP 三次握手", "TCP", "HTTP 缓存", "TCP 拥塞控制"];
  const snapshot = {
    version: "v1",
    items: entries.map((entry, index) => ({ ...entry, title: titles[index], course_id: index === 3 ? 2 : 1 })),
    byId: new Map(entries.map(entry => [entry.id, entry])),
  };

  it("按相关度排序，支持课程过滤与条数上限", () => {
    expect(searchQaSnapshot(snapshot, "TCP")).toEqual([2, 4, 1]);
    expect(searchQaSnapshot(snapshot, "TCP", { courseId: 1 })).toEqual([2, 1]);
    expect(searchQaSnapshot(snapshot, "TCP", { courseId: 1, limit: 1 })).toEqual([2]);
  });

  it("无命中与空关键词返回空候选", () => {
    expect(searchQaSnapshot(snapshot, "数据库索引")).toEqual([]);
    expect(searchQaSnapshot(snapshot, "  ")).toEqual([]);
  });

  it("长问句按 2-gram 兜底命中标题", () => {
    expect(searchQaSnapshot(snapshot, "怎么理解三次握手流程")).toEqual([1]);
  });
});
