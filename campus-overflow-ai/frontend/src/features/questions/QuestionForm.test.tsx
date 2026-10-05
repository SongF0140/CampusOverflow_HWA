import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { NewQuestionPanel } from "@/app/(student)/questions/new/NewQuestionPanel";
import { ApiError } from "@/api/client";
import type { Course } from "@/shared/types/course";
import type { TagListItem } from "@/shared/types/tag";

import { NEW_QUESTION_DRAFT_KEY } from "./draft";
import { QuestionForm, type QuestionFormProps } from "./QuestionForm";

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  back: vi.fn(),
  listCourses: vi.fn(),
  listTags: vi.fn(),
  createQuestion: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push, back: mocks.back, replace: vi.fn() }),
}));
vi.mock("@/api/courses", () => ({ listCourses: mocks.listCourses }));
vi.mock("@/api/tags", () => ({ listTags: mocks.listTags }));
vi.mock("@/api/questions", () => ({ createQuestion: mocks.createQuestion }));

const COURSES: Course[] = [
  { id: 1, name: "数据结构", code: "CS201", teacher_name: "张老师", member_count: 60, question_count: 24, created_at: "2026-09-01T08:00:00" },
  { id: 2, name: "操作系统", code: "CS301", teacher_name: "刘老师", member_count: 55, question_count: 18, created_at: "2026-09-01T08:00:00" },
];

const TAGS: TagListItem[] = [
  { id: 5, name: "面试高频", type: "custom", question_count: 9 },
  { id: 6, name: "操作系统", type: "course", question_count: 3 },
];

const TITLE = "快速排序最坏情况分析";
const BODY = "正文内容：已随机化 pivot 仍会退化。";

beforeEach(() => {
  window.localStorage.clear();
  mocks.push.mockReset();
  mocks.back.mockReset();
  mocks.listCourses.mockReset().mockResolvedValue({ items: COURSES, total: 2, page: 1, page_size: 100 });
  mocks.listTags.mockReset().mockResolvedValue({ items: TAGS });
  mocks.createQuestion.mockReset();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

async function renderForm(props: Partial<QuestionFormProps> = {}) {
  const onSubmit = props.onSubmit ?? vi.fn().mockResolvedValue(undefined);
  // 默认启用草稿（对齐 NewQuestionPanel 的真实接线），用例可显式覆盖
  const utils = render(
    <QuestionForm
      {...props}
      draftKey={props.draftKey ?? NEW_QUESTION_DRAFT_KEY}
      onSubmit={onSubmit as QuestionFormProps["onSubmit"]}
    />,
  );
  // 等课程选项加载完成（多于"请选择课程"一项）
  await waitFor(() => {
    const select = screen.getByLabelText("课程") as HTMLSelectElement;
    expect(select.options.length).toBeGreaterThan(1);
  });
  return { onSubmit, ...utils };
}

function fillValidForm(): void {
  fireEvent.change(screen.getByLabelText("标题"), { target: { value: TITLE } });
  fireEvent.change(screen.getByLabelText("正文"), { target: { value: BODY } });
  fireEvent.change(screen.getByLabelText("课程"), { target: { value: "1" } });
}

describe("QuestionForm 标题与提交校验", () => {
  it("标题失焦校验：空/过短/超长分别提示，右下角计数 x/100", async () => {
    await renderForm();
    const title = screen.getByLabelText("标题") as HTMLInputElement;

    fireEvent.blur(title);
    expect(screen.getByText("请输入标题")).toBeTruthy();

    fireEvent.change(title, { target: { value: "abc" } });
    fireEvent.blur(title);
    expect(screen.getByText("标题至少 5 个字符")).toBeTruthy();

    fireEvent.change(title, { target: { value: "字".repeat(101) } });
    fireEvent.blur(title);
    expect(screen.getByText("标题最多 100 个字符")).toBeTruthy();
    expect(screen.getByText("101/100")).toBeTruthy();
  });

  it("空表单提交被拦截：不调用 onSubmit，正文/课程行内提示", async () => {
    const { onSubmit } = await renderForm();

    fireEvent.click(screen.getByRole("button", { name: "提交问题" }));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText("请输入正文")).toBeTruthy();
    // "请选择课程" 同时是 Select 默认 option 文案与校验提示，用 getAllByText 断言
    expect(screen.getAllByText("请选择课程").length).toBeGreaterThan(0);
  });

  it("提交成功：蛇形 payload + onSuccess 回调 + Toast 发布成功", async () => {
    const onSuccess = vi.fn();
    const { onSubmit } = await renderForm({
      onSuccess,
      onSubmit: vi.fn().mockResolvedValue({ id: 9 }),
      initialValues: { tags: [{ id: 5, name: "面试高频" }, { name: "手打新标签" }] },
    });
    fillValidForm();

    fireEvent.click(screen.getByRole("button", { name: "提交问题" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit).toHaveBeenCalledWith({
      title: TITLE,
      body: BODY,
      course_id: 1,
      tag_ids: [5, "手打新标签"],
    });
    expect(onSuccess).toHaveBeenCalledWith({ id: 9 });
    expect(await screen.findByText("发布成功")).toBeTruthy();
  });

  it("取消按钮返回来源页（router.back）", async () => {
    await renderForm();
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(mocks.back).toHaveBeenCalledTimes(1);
  });
});

describe("QuestionForm 正文编辑与预览", () => {
  it("预览 Tab 用 MarkdownView 只读渲染；输入停顿 1s 后缓存更新", async () => {
    await renderForm({ initialValues: { content: "第一段 **加粗**" } });

    // 初始缓存直接渲染为 strong
    fireEvent.click(screen.getByRole("tab", { name: "预览" }));
    const strong = screen.getByText("加粗").closest("strong");
    expect(strong).not.toBeNull();

    // 停顿未满 1s 就切回预览：展示的是旧缓存
    fireEvent.click(screen.getByRole("tab", { name: "编辑" }));
    fireEvent.change(screen.getByLabelText("正文"), { target: { value: "第二段 *斜体*" } });
    fireEvent.click(screen.getByRole("tab", { name: "预览" }));
    expect(screen.queryByText("斜体")).toBeNull();

    // 停顿 1s 后预览缓存更新为 em
    await waitFor(() => expect(screen.getByText("斜体")).toBeTruthy(), { timeout: 2500 });
    expect(screen.getByText("斜体").closest("em")).not.toBeNull();
  });

  it("工具条向正文插入 Markdown 语法", async () => {
    await renderForm();
    fireEvent.click(screen.getByRole("button", { name: "插入加粗" }));
    const body = screen.getByLabelText("正文") as HTMLTextAreaElement;
    expect(body.value).toContain("**加粗文本**");
  });
});

describe("QuestionForm 标签选择", () => {
  it("搜索选中已有标签；已选不再出现在候选中；可 × 移除", async () => {
    await renderForm();
    const search = screen.getByLabelText("搜索标签");

    fireEvent.change(search, { target: { value: "面试" } });
    fireEvent.click(await screen.findByText("面试高频"));
    expect(screen.getByText("1/5")).toBeTruthy();
    expect(screen.getByText("面试高频").closest("span")).not.toBeNull();

    // 重复添加去重：已选标签不再作为候选出现
    fireEvent.change(search, { target: { value: "面试" } });
    await waitFor(() => expect(screen.getByText("3 个问题")).toBeTruthy());
    expect(screen.queryByText("9 个问题")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "移除标签 面试高频" }));
    // chip 的移除按钮消失、计数归零（下拉候选中同名标签仍可见，不算已选）
    expect(screen.queryByRole("button", { name: "移除标签 面试高频" })).toBeNull();
    expect(screen.getByText("0/5")).toBeTruthy();
  });

  it("支持内联创建新标签，提交时以字符串进入 tag_ids", async () => {
    const { onSubmit } = await renderForm({
      onSubmit: vi.fn().mockResolvedValue({ id: 1 }),
    });
    fillValidForm();

    const search = screen.getByLabelText("搜索标签");
    fireEvent.change(search, { target: { value: "动态规划" } });
    fireEvent.click(await screen.findByText("创建新标签「动态规划」"));
    expect(screen.getByText("动态规划")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "提交问题" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ tag_ids: ["动态规划"] }),
    );
  });

  it("已选满 5 个后禁止添加并提示最多 5 个标签", async () => {
    mocks.listTags.mockResolvedValue({ items: [] });
    await renderForm({
      initialValues: {
        tags: [
          { id: 1, name: "标签一" },
          { id: 2, name: "标签二" },
          { id: 3, name: "标签三" },
          { id: 4, name: "标签四" },
          { id: 5, name: "标签五" },
        ],
      },
    });
    expect(screen.getByText("5/5")).toBeTruthy();

    const search = screen.getByLabelText("搜索标签");
    fireEvent.change(search, { target: { value: "第六个" } });
    fireEvent.click(await screen.findByText("创建新标签「第六个」"));

    expect(screen.getByText("最多 5 个标签")).toBeTruthy();
    expect(screen.getByText("5/5")).toBeTruthy();
    expect(screen.queryByText("第六个")).toBeNull();
  });
});

describe("QuestionForm 草稿", () => {
  it("进入页面有草稿且表单为空 → 询问恢复；恢复回填标题与标签", async () => {
    window.localStorage.setItem(
      NEW_QUESTION_DRAFT_KEY,
      JSON.stringify({
        title: "草稿标题内容",
        content: "草稿正文",
        course_id: 2,
        tag_ids: ["草稿标签"],
        tag_names: ["草稿标签"],
        updatedAt: new Date(Date.now() - 5 * 60_000).toISOString(),
      }),
    );

    await renderForm();

    expect(
      await screen.findByText(/检测到未提交的草稿（保存于 5 分钟前）/),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "恢复" }));
    expect((screen.getByLabelText("标题") as HTMLInputElement).value).toBe("草稿标题内容");
    expect((screen.getByLabelText("课程") as HTMLSelectElement).value).toBe("2");
    expect(screen.getByText("草稿标签")).toBeTruthy();
    expect(screen.queryByText(/检测到未提交的草稿/)).toBeNull();
  });

  it("丢弃草稿：清除 localStorage 并收起提示条", async () => {
    window.localStorage.setItem(
      NEW_QUESTION_DRAFT_KEY,
      JSON.stringify({
        title: "草稿标题内容",
        content: "",
        course_id: null,
        tag_ids: [],
        tag_names: null,
        updatedAt: new Date().toISOString(),
      }),
    );

    await renderForm();
    fireEvent.click(await screen.findByRole("button", { name: "丢弃" }));

    expect(window.localStorage.getItem(NEW_QUESTION_DRAFT_KEY)).toBeNull();
    expect(screen.queryByText(/检测到未提交的草稿/)).toBeNull();
  });

  it("beforeunload 兜底保存当前内容", async () => {
    await renderForm();
    fillValidForm();

    window.dispatchEvent(new Event("beforeunload"));

    const raw = window.localStorage.getItem(NEW_QUESTION_DRAFT_KEY);
    expect(raw).not.toBeNull();
    const draft = JSON.parse(raw ?? "{}") as { title?: string; content?: string };
    expect(draft.title).toBe(TITLE);
    expect(draft.content).toBe(BODY);
  });

  it("30s 定时自动保存", () => {
    vi.useFakeTimers();
    try {
      render(<QuestionForm draftKey={NEW_QUESTION_DRAFT_KEY} onSubmit={vi.fn()} />);
      fireEvent.change(screen.getByLabelText("标题"), {
        target: { value: "定时保存的标题内容" },
      });

      act(() => {
        vi.advanceTimersByTime(30_000);
      });

      const raw = window.localStorage.getItem(NEW_QUESTION_DRAFT_KEY);
      expect(raw).not.toBeNull();
      expect((JSON.parse(raw ?? "{}") as { title?: string }).title).toBe("定时保存的标题内容");
    } finally {
      vi.useRealTimers();
      cleanup();
    }
  });
});

describe("QuestionForm 提交失败", () => {
  it("500：ErrorState 提示服务开小差，表单内容保留并写入草稿", async () => {
    await renderForm({ onSubmit: vi.fn().mockRejectedValue(new ApiError(500, "服务器错误")) });
    fillValidForm();

    fireEvent.click(screen.getByRole("button", { name: "提交问题" }));

    expect(await screen.findByText("服务开小差了，请稍后重试")).toBeTruthy();
    expect((screen.getByLabelText("标题") as HTMLInputElement).value).toBe(TITLE);
    const raw = window.localStorage.getItem(NEW_QUESTION_DRAFT_KEY);
    expect(raw).not.toBeNull();
    expect((JSON.parse(raw ?? "{}") as { title?: string }).title).toBe(TITLE);
  });

  it("400：Toast 透传后端中文 message，表单不重置", async () => {
    await renderForm({
      onSubmit: vi.fn().mockRejectedValue(new ApiError(400, "标题包含敏感词")),
    });
    fillValidForm();

    fireEvent.click(screen.getByRole("button", { name: "提交问题" }));

    expect(await screen.findByText("标题包含敏感词")).toBeTruthy();
    expect(screen.queryByText("服务开小差了，请稍后重试")).toBeNull();
    expect((screen.getByLabelText("标题") as HTMLInputElement).value).toBe(TITLE);
  });
});

describe("NewQuestionPanel 发布接线", () => {
  it("提交调用 createQuestion（蛇形入参），成功后跳转 /questions/{id}", async () => {
    mocks.createQuestion.mockResolvedValue({
      id: 55,
      title: TITLE,
      status: "unresolved",
      created_at: "2026-10-06T10:00:00+08:00",
    });
    render(<NewQuestionPanel initialCourseId={null} />);
    await waitFor(() => {
      const select = screen.getByLabelText("课程") as HTMLSelectElement;
      expect(select.options.length).toBeGreaterThan(1);
    });

    fillValidForm();
    fireEvent.click(screen.getByRole("button", { name: "提交问题" }));

    await waitFor(() => expect(mocks.createQuestion).toHaveBeenCalledTimes(1));
    expect(mocks.createQuestion).toHaveBeenCalledWith({
      title: TITLE,
      body: BODY,
      course_id: 1,
      tag_ids: [],
    });
    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith("/questions/55"));
  });
});
