import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getQuestion: vi.fn(),
  updateQuestion: vi.fn(),
  deleteQuestion: vi.fn(),
  listCourses: vi.fn(),
  push: vi.fn(),
  // session-store 以可变对象模拟，按用例切换登录态
  session: {
    status: "authed",
    me: null as { username: string; role: string } | null,
  },
}));

vi.mock("@/api/questions", () => ({
  getQuestion: mocks.getQuestion,
  updateQuestion: mocks.updateQuestion,
  deleteQuestion: mocks.deleteQuestion,
}));

// QuestionForm 内部拉课程下拉选项
vi.mock("@/api/courses", () => ({
  listCourses: mocks.listCourses,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push, replace: vi.fn(), prefetch: vi.fn() }),
}));

vi.mock("@/shared/stores/session-store", () => ({
  useSessionStore: (selector: (state: typeof mocks.session) => unknown) =>
    selector(mocks.session),
}));

import { ApiError } from "@/api/client";
import type { QuestionDetail } from "@/shared/types/question";

import { EditQuestionPanel } from "./EditQuestionPanel";

const QUESTION: QuestionDetail = {
  id: 1,
  title: "红黑树删除为什么要分四种情况？",
  body: "如题，教材只给了结论，求推导过程。",
  course_id: 3,
  author: "alice",
  tags: [
    { id: 10, name: "数据结构", type: "system" },
    { id: 11, name: "考研", type: "custom" },
  ],
  status: "published",
  vote_score: 2,
  my_vote: 0,
  accepted_answer_id: null,
  view_count: 15,
  created_at: "2026-10-01T10:00:00+08:00",
  updated_at: "2026-10-01T10:00:00+08:00",
};

const COURSES = {
  items: [
    { id: 3, name: "数据结构" },
    { id: 4, name: "操作系统" },
  ],
  total: 2,
  page: 1,
  page_size: 20,
};

function renderPanel(): void {
  render(<EditQuestionPanel questionId={1} />);
}

// 仓库测试不引 jest-dom matchers，输入值/禁用态用原生属性断言
function inputValue(element: HTMLElement): string {
  return (element as HTMLInputElement).value;
}

describe("EditQuestionPanel", () => {
  beforeEach(() => {
    mocks.getQuestion.mockResolvedValue(QUESTION);
    mocks.updateQuestion.mockResolvedValue({ ...QUESTION, title: "新标题" });
    mocks.deleteQuestion.mockResolvedValue({ deleted: true });
    mocks.listCourses.mockResolvedValue(COURSES);
    mocks.session.status = "authed";
    mocks.session.me = { username: "alice", role: "student" };
    window.localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("作者进入：预填标题与正文，课程/标签锁定只读", async () => {
    renderPanel();

    const titleInput = await screen.findByLabelText("标题");
    expect(inputValue(titleInput)).toBe(QUESTION.title);
    expect(inputValue(screen.getByLabelText("正文"))).toBe(QUESTION.body);

    // 课程禁用 + 标签为只读 chip（TagPicker 搜索框不出现）
    expect((screen.getByLabelText("课程") as HTMLSelectElement).disabled).toBe(true);
    // "数据结构" 同时出现在课程 option 与标签 chip，断言存在即可；"考研" 仅 chip 有
    expect(screen.getAllByText("数据结构").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("考研")).toBeTruthy();
    expect(screen.queryByLabelText("搜索标签")).toBeNull();
    expect(screen.getByText("标签发布后暂不支持修改")).toBeTruthy();
  });

  it("提交保存：PATCH 只带 title/body，成功后回详情页", async () => {
    renderPanel();

    const titleInput = await screen.findByLabelText("标题");
    fireEvent.change(titleInput, { target: { value: "红黑树删除到底怎么推导？" } });
    fireEvent.click(screen.getByRole("button", { name: "保存修改" }));

    await waitFor(() => {
      expect(mocks.updateQuestion).toHaveBeenCalledWith(1, {
        title: "红黑树删除到底怎么推导？",
        body: QUESTION.body,
      });
    });
    await waitFor(() => {
      expect(mocks.push).toHaveBeenCalledWith("/questions/1");
    });
    // 锁定字段不参与 PATCH 负载
    const patchPayload = mocks.updateQuestion.mock.calls[0][1] as Record<string, unknown>;
    expect(patchPayload).not.toHaveProperty("course_id");
    expect(patchPayload).not.toHaveProperty("tag_ids");
  });

  it("非作者访问：展示无权限提示，不渲染表单", async () => {
    mocks.session.me = { username: "bob", role: "student" };
    renderPanel();

    expect(await screen.findByText("只有作者可以编辑该问题")).toBeTruthy();
    expect(screen.queryByLabelText("标题")).toBeNull();
  });

  it("问题不存在：渲染缺失态", async () => {
    mocks.getQuestion.mockRejectedValue(new ApiError(404, "问题不存在"));
    renderPanel();

    expect(await screen.findByText("内容不存在或已删除")).toBeTruthy();
  });

  it("删除问题：确认弹窗后调用 DELETE 并回广场", async () => {
    renderPanel();

    fireEvent.click(await screen.findByRole("button", { name: "删除问题" }));
    expect(screen.getByRole("dialog", { name: "确认删除该问题？" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "确认删除" }));
    await waitFor(() => {
      expect(mocks.deleteQuestion).toHaveBeenCalledWith(1);
    });
    await waitFor(() => {
      expect(mocks.push).toHaveBeenCalledWith("/");
    });
  });

  it("删除失败：留在编辑页展示后端原因", async () => {
    mocks.deleteQuestion.mockRejectedValue(new ApiError(403, "无权删除该问题"));
    renderPanel();

    fireEvent.click(await screen.findByRole("button", { name: "删除问题" }));
    fireEvent.click(screen.getByRole("button", { name: "确认删除" }));

    expect(await screen.findByText("无权删除该问题")).toBeTruthy();
  });
});
