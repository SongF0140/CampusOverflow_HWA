import { describe, expect, it } from "vitest";
import { discloseMemory } from "../src/memory/disclosure.js";

const principal = { user_id: 7 };
const base = { owner_id: 7, session_id: "f81d4fae-7dec-41d0-a765-00a0c91e6bf6", message: "死锁", stage: "index" };

describe("个人记忆渐进披露", () => {
  it("先仅索引筛选，相关主题和长期偏好优先", () => {
    expect(discloseMemory({ ...base, items: [
      { id: "one", text: "线性代数" }, { id: "two", text: "死锁问题" },
      { id: "three", text: "偏好简洁回答" },
    ] }, principal).selected_ids).toEqual(["two", "three"]);
  });
  it("拒绝其他账号和伪造字段，不持有跨请求记忆", () => {
    expect(() => discloseMemory({ ...base, owner_id: 8, items: [] }, principal)).toThrow();
    expect(() => discloseMemory({ ...base, role: "admin", items: [] }, principal)).toThrow();
    expect(discloseMemory({ ...base, items: [] }, principal).selected_ids).toEqual([]);
  });
  it("拒绝在索引层偷偷放入全文", () => {
    expect(() => discloseMemory({ ...base, items: [{ id: "a", text: "字".repeat(37) }] }, principal)).toThrow();
  });
  it("摘要阶段至多选三项，详情阶段统一限制预算", () => {
    const items = Array.from({ length: 5 }, (_, i) => ({ id: `${i}`, text: "死锁摘要" }));
    expect(discloseMemory({ ...base, stage: "summary", items }, principal).selected_ids).toHaveLength(3);
    expect(() => discloseMemory({ ...base, stage: "detail", items }, principal)).toThrow();
    expect(discloseMemory({ ...base, stage: "detail", items: items.slice(0, 2) }, principal).items).toHaveLength(2);
  });
});
