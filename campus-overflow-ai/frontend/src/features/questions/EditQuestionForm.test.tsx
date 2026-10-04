import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  replace: vi.fn(),
  refresh: vi.fn(),
  fetchQuestionDetail: vi.fn(),
  fetchCourseDetail: vi.fn(),
  updateQuestion: vi.fn(),
  deleteQuestion: vi.fn(),
  currentUsername: "student01",
}));

const noopLoad = async () => {};

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mocks.replace, refresh: mocks.refresh }),
}));
vi.mock("@/api/courses", () => ({ fetchCourseDetail: mocks.fetchCourseDetail }));
vi.mock("@/api/questions", () => ({
  fetchQuestionDetail: mocks.fetchQuestionDetail,
  updateQuestion: mocks.updateQuestion,
  deleteQuestion: mocks.deleteQuestion,
}));
vi.mock("@/shared/stores/session-store", () => ({
  useSessionStore: (selector: (state: unknown) => unknown) =>
    selector({ user: { username: mocks.currentUsername }, status: "ready", load: noopLoad }),
}));

import { EditQuestionForm } from "./EditQuestionForm";

const DETAIL = {
  id: 4,
  title: "二分查找边界怎么处理？",
  body: "我在写二分时总是死循环。",
  course_id: 1,
  author: "student01",
  tags: [{ id: 1, name: "红黑树", type: "tech" }],
  status: "published",
  vote_score: 0,
  my_vote: 0,
  accepted_answer_id: null,
  view_count: 1,
  created_at: "2026-10-04T14:29:19",
  updated_at: "2026-10-04T14:29:19",
};

beforeEach(() => {
  mocks.currentUsername = "student01";
  mocks.replace.mockReset();
  mocks.refresh.mockReset();
  mocks.fetchQuestionDetail.mockReset().mockResolvedValue(DETAIL);
  mocks.fetchCourseDetail.mockReset().mockResolvedValue({ name: "数据结构" });
  mocks.updateQuestion.mockReset();
  mocks.deleteQuestion.mockReset();
});

afterEach(cleanup);

describe("EditQuestionForm", () => {
  it("预填标题与正文，并说明课程/标签不可改", async () => {
    render(<EditQuestionForm questionId={4} />);

    await waitFor(() => expect(screen.getByDisplayValue("二分查找边界怎么处理？")).toBeTruthy());
    expect(screen.getByDisplayValue("我在写二分时总是死循环。")).toBeTruthy();
    expect(screen.getByText(/课程与标签暂不支持修改/)).toBeTruthy();
    expect(await screen.findByText(/数据结构/)).toBeTruthy();
  });

  it("保存成功后回到问题详情页（后端更新文案是「发布成功」也不误当成提示）", async () => {
    mocks.updateQuestion.mockResolvedValue({
      data: { id: 4, title: "改了标题", updated_at: "" },
      message: "发布成功",
    });
    render(<EditQuestionForm questionId={4} />);
    await waitFor(() => expect(screen.getByDisplayValue("二分查找边界怎么处理？")).toBeTruthy());

    fireEvent.change(screen.getByDisplayValue("二分查找边界怎么处理？"), {
      target: { value: "改了标题" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存修改" }));

    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith("/questions/4"));
    expect(mocks.updateQuestion).toHaveBeenCalledWith(4, {
      title: "改了标题",
      body: "我在写二分时总是死循环。",
    });
  });

  it("后端附加提示（超长截断）时把提示带到详情页", async () => {
    mocks.updateQuestion.mockResolvedValue({
      data: { id: 4, title: "t", updated_at: "" },
      message: "发布成功（内容超长已截断：标题 ≤ 100 字、正文 ≤ 20000 字）",
    });
    render(<EditQuestionForm questionId={4} />);
    await waitFor(() => expect(screen.getByDisplayValue("二分查找边界怎么处理？")).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: "保存修改" }));

    await waitFor(() =>
      expect(mocks.replace).toHaveBeenCalledWith(
        "/questions/4?notice=" +
          encodeURIComponent("发布成功（内容超长已截断：标题 ≤ 100 字、正文 ≤ 20000 字）"),
      ),
    );
  });

  it("非作者看不到编辑表单", async () => {
    mocks.currentUsername = "other01";
    render(<EditQuestionForm questionId={4} />);

    await waitFor(() => expect(screen.getByText("只有提问者可以编辑这个问题")).toBeTruthy());
    expect(screen.queryByRole("button", { name: "保存修改" })).toBeNull();
  });

  it("删除需要二次确认，确认后回到问题广场", async () => {
    mocks.deleteQuestion.mockResolvedValue({ deleted: true });
    render(<EditQuestionForm questionId={4} />);
    await waitFor(() => expect(screen.getByDisplayValue("二分查找边界怎么处理？")).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: "删除问题" }));
    expect(screen.getByRole("dialog")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "确认删除" }));

    await waitFor(() => expect(mocks.deleteQuestion).toHaveBeenCalledWith(4));
    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith("/"));
  });
});
