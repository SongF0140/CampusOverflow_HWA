// 浏览器个人记忆模块测试（T-14 M-01，AG-R04/Q-10）：
// 账号命名空间隔离、清空后不参与请求、敏感写入拦截（原因不含原文）、容量与重复约束。
import { beforeEach, describe, expect, it } from "vitest";

import {
  MEMORY_CONTENT_MAX_LEN,
  MEMORY_MAX_ENTRIES,
  addMemoryEntry,
  buildMemoryContext,
  clearMemoryEntries,
  listMemoryEntries,
  removeMemoryEntry,
} from "./browser-memory";

beforeEach(() => {
  window.localStorage.clear();
});

describe("browser-memory 账号隔离", () => {
  it("不同账号命名空间互不可见（切换/退出/重登不串用）", () => {
    addMemoryEntry(1, "偏好用中文回复");
    addMemoryEntry(2, "正在备考操作系统");

    expect(listMemoryEntries(1).map((entry) => entry.content))
      .toEqual(["偏好用中文回复"]);
    expect(listMemoryEntries(2).map((entry) => entry.content))
      .toEqual(["正在备考操作系统"]);

    // 用户 1 清空不影响用户 2
    clearMemoryEntries(1);
    expect(listMemoryEntries(1)).toEqual([]);
    expect(listMemoryEntries(2)).toHaveLength(1);
  });

  it("清空后注入上下文为空数组，不再参与请求与建议", () => {
    addMemoryEntry(7, "偏好简洁回答");
    expect(buildMemoryContext(7)).toEqual(["偏好简洁回答"]);
    clearMemoryEntries(7);
    expect(buildMemoryContext(7)).toEqual([]);
  });

  it("数据持久于 localStorage（同账号刷新后仍可读）", () => {
    addMemoryEntry(9, "课程上下文：操作系统");
    expect(window.localStorage.getItem("co_memory_user_9")).toContain("操作系统");
    expect(listMemoryEntries(9)).toHaveLength(1);
  });
});

describe("browser-memory 写入约束", () => {
  it("敏感内容拒绝且原因不含原文（X-06）", () => {
    const result = addMemoryEntry(1, "我的 api_key 是 abc123");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain("敏感信息");
      expect(result.reason).not.toContain("abc123");
      expect(result.reason).not.toContain("api_key");
    }
    expect(listMemoryEntries(1)).toEqual([]);

    // 中文关键词同样拦截
    expect(addMemoryEntry(1, "我的密码是123456").ok).toBe(false);
    expect(listMemoryEntries(1)).toEqual([]);
  });

  it("空白/超长/重复/超上限拒绝", () => {
    expect(addMemoryEntry(3, "   ").ok).toBe(false);
    expect(addMemoryEntry(3, "长".repeat(MEMORY_CONTENT_MAX_LEN + 1)).ok).toBe(false);

    expect(addMemoryEntry(3, "偏好简洁回答").ok).toBe(true);
    expect(addMemoryEntry(3, "偏好简洁回答").ok).toBe(false); // 重复

    for (let i = 0; i < MEMORY_MAX_ENTRIES - 1; i += 1) {
      expect(addMemoryEntry(3, `记忆条目 ${i}`).ok).toBe(true);
    }
    expect(addMemoryEntry(3, "超出容量的一条新记忆").ok).toBe(false);
    expect(listMemoryEntries(3)).toHaveLength(MEMORY_MAX_ENTRIES);
  });

  it("删除单条与列表倒序", () => {
    addMemoryEntry(5, "第一条");
    addMemoryEntry(5, "第二条");
    const entries = listMemoryEntries(5);
    expect(entries[0]?.content).toBe("第二条"); // 最新在前

    const next = removeMemoryEntry(5, entries[0]!.id);
    expect(next.map((entry) => entry.content)).toEqual(["第一条"]);
  });
});

describe("browser-memory 注入助手", () => {
  it("按最新在前取前 20 条（与 Agent 契约对齐）", () => {
    for (let i = 0; i < 25; i += 1) {
      addMemoryEntry(11, `记忆内容 ${i}`);
    }
    const context = buildMemoryContext(11);
    expect(context).toHaveLength(20);
    expect(context[0]).toBe("记忆内容 24"); // 最新在前
  });
});
