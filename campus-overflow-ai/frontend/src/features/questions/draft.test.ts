import { beforeEach, describe, expect, it } from "vitest";

import {
  NEW_QUESTION_DRAFT_KEY,
  clearDraft,
  draftToPickedTags,
  loadDraft,
  saveDraft,
  shouldRestore,
  type QuestionDraft,
} from "./draft";

const BASE_VALUES = {
  title: "为什么快速排序的最坏情况是 O(n²)？",
  content: "如题，已经随机化 pivot 仍会退化。",
  course_id: 1,
  tag_ids: [5, "新标签"],
  tag_names: ["面试高频", "新标签"],
};

beforeEach(() => {
  window.localStorage.clear();
});

describe("draft 草稿纯函数", () => {
  it("saveDraft → loadDraft 往返保留全部字段并带 updatedAt", () => {
    const before = Date.now();
    expect(saveDraft(NEW_QUESTION_DRAFT_KEY, BASE_VALUES)).toBe(true);

    const draft = loadDraft(NEW_QUESTION_DRAFT_KEY);
    expect(draft).not.toBeNull();
    expect(draft?.title).toBe(BASE_VALUES.title);
    expect(draft?.content).toBe(BASE_VALUES.content);
    expect(draft?.course_id).toBe(1);
    expect(draft?.tag_ids).toEqual([5, "新标签"]);
    expect(draft?.tag_names).toEqual(["面试高频", "新标签"]);
    const savedAt = Date.parse(draft?.updatedAt ?? "");
    expect(savedAt).toBeGreaterThanOrEqual(before);
    expect(savedAt).toBeLessThanOrEqual(Date.now());
  });

  it("loadDraft：无草稿/损坏 JSON/非法结构均返回 null", () => {
    expect(loadDraft(NEW_QUESTION_DRAFT_KEY)).toBeNull();

    window.localStorage.setItem(NEW_QUESTION_DRAFT_KEY, "{not-json");
    expect(loadDraft(NEW_QUESTION_DRAFT_KEY)).toBeNull();

    window.localStorage.setItem(NEW_QUESTION_DRAFT_KEY, JSON.stringify(["not", "object"]));
    expect(loadDraft(NEW_QUESTION_DRAFT_KEY)).toBeNull();

    // updatedAt 缺失视为无草稿
    window.localStorage.setItem(NEW_QUESTION_DRAFT_KEY, JSON.stringify({ title: "x" }));
    expect(loadDraft(NEW_QUESTION_DRAFT_KEY)).toBeNull();
  });

  it("clearDraft 后不再可读", () => {
    saveDraft(NEW_QUESTION_DRAFT_KEY, BASE_VALUES);
    expect(clearDraft(NEW_QUESTION_DRAFT_KEY)).toBe(true);
    expect(loadDraft(NEW_QUESTION_DRAFT_KEY)).toBeNull();
  });

  it("shouldRestore：草稿有内容且表单为空才恢复", () => {
    const draft: QuestionDraft = {
      ...BASE_VALUES,
      updatedAt: new Date().toISOString(),
    };

    expect(shouldRestore(draft, { title: "", content: "" })).toBe(true);
    // 空草稿（只有课程/标签）不值得恢复
    expect(
      shouldRestore({ ...draft, title: "", content: "" }, { title: "", content: "" }),
    ).toBe(false);
    // 表单已有内容（编辑页 initialValues）不询问
    expect(shouldRestore(draft, { title: "已有标题内容足够长", content: "" })).toBe(false);
    expect(shouldRestore(null, { title: "", content: "" })).toBe(false);
  });

  it("draftToPickedTags：int 还原为已有标签，str 还原为新标签，缺名时降级占位", () => {
    const draft: QuestionDraft = {
      ...BASE_VALUES,
      tag_names: null,
      updatedAt: new Date().toISOString(),
    };
    expect(draftToPickedTags(draft)).toEqual([
      { id: 5, name: "标签 5" },
      { name: "新标签" },
    ]);

    expect(
      draftToPickedTags({ ...draft, tag_names: ["面试高频", "新标签"] }),
    ).toEqual([
      { id: 5, name: "面试高频" },
      { name: "新标签" },
    ]);
  });
});
