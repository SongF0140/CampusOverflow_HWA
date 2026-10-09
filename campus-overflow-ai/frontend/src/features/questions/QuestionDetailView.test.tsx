import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fetchQuestionDetail: vi.fn(),
  fetchAnswers: vi.fn(),
  fetchRelatedQuestions: vi.fn(),
  fetchCourseDetail: vi.fn(),
  vote: vi.fn(),
  acceptAnswer: vi.fn(),
  certifyAnswer: vi.fn(),
  uncertifyAnswer: vi.fn(),
  createAnswer: vi.fn(),
  fetchQuestionComments: vi.fn(),
  createQuestionComment: vi.fn(),
  deleteComment: vi.fn(),
  currentUsername: "student01",
  currentRole: "student",
}));

const noopLoad = async () => {};

vi.mock("@/api/questions", () => ({
  fetchQuestionDetail: mocks.fetchQuestionDetail,
  fetchAnswers: mocks.fetchAnswers,
  fetchRelatedQuestions: mocks.fetchRelatedQuestions,
  vote: mocks.vote,
  acceptAnswer: mocks.acceptAnswer,
  certifyAnswer: mocks.certifyAnswer,
  uncertifyAnswer: mocks.uncertifyAnswer,
  createAnswer: mocks.createAnswer,
  fetchQuestionComments: mocks.fetchQuestionComments,
  createQuestionComment: mocks.createQuestionComment,
  deleteComment: mocks.deleteComment,
}));
vi.mock("@/api/courses", () => ({ fetchCourseDetail: mocks.fetchCourseDetail }));
vi.mock("@/shared/stores/session-store", () => ({
  useSessionStore: (
    selector: (state: {
      me: { username: string; role: string } | null;
      loadMe: () => Promise<void>;
    }) => unknown,
  ) =>
    selector({
      me: mocks.currentUsername
        ? { username: mocks.currentUsername, role: mocks.currentRole }
        : null,
      loadMe: noopLoad,
    }),
}));

import { QuestionDetailView } from "./QuestionDetailView";

const DETAIL = {
  id: 4,
  title: "二分查找边界怎么处理？",
  body: "我在写二分时总是死循环。",
  course_id: 1,
  author: "student01",
  tags: [{ id: 1, name: "红黑树", type: "tech" }],
  status: "resolved",
  vote_score: 3,
  my_vote: 0,
  accepted_answer_id: 1,
  view_count: 10,
  created_at: "2026-10-04T14:29:19",
  updated_at: "2026-10-04T14:29:19",
};

const ANSWER = {
  id: 1,
  author: "teacher01",
  body: "用左闭右开区间就不会死循环。",
  vote_score: 2,
  my_vote: 0,
  is_accepted: true,
  recommended_by_assistant: false,
  certified_by_teacher: false,
  created_at: "2026-10-04T14:30:29",
};

beforeEach(() => {
  mocks.currentUsername = "student01";
  mocks.currentRole = "student";
  mocks.fetchQuestionDetail.mockReset().mockResolvedValue(DETAIL);
  mocks.fetchAnswers.mockReset().mockResolvedValue({ items: [ANSWER], total: 1, page: 1 });
  mocks.fetchRelatedQuestions.mockReset().mockResolvedValue({ items: [] });
  mocks.fetchCourseDetail.mockReset().mockResolvedValue({
    name: "数据结构",
    teacher_name: "teacher01",
    is_owner: mocks.currentRole === "teacher" && mocks.currentUsername === "teacher01",
  });
  mocks.vote.mockReset();
  mocks.acceptAnswer.mockReset();
  mocks.certifyAnswer.mockReset();
  mocks.uncertifyAnswer.mockReset();
  mocks.createAnswer.mockReset();
  mocks.fetchQuestionComments.mockReset().mockResolvedValue({ items: [], total: 0, page: 1 });
  mocks.createQuestionComment.mockReset();
  mocks.deleteComment.mockReset();
});

afterEach(cleanup);

describe("QuestionDetailView", () => {
  it("渲染标题、正文、课程面包屑与已采纳回答", async () => {
    render(<QuestionDetailView questionId={4} />);

    await waitFor(() => expect(screen.getByRole("heading", { name: "二分查找边界怎么处理？" })).toBeTruthy());
    expect(screen.getByText("我在写二分时总是死循环。")).toBeTruthy();
    expect(await screen.findByText("数据结构")).toBeTruthy();
    expect(screen.getByText("已采纳")).toBeTruthy();
    expect(screen.getByText("teacher01")).toBeTruthy();
  });

  it("提问者本人可见采纳按钮；非本人不可见", async () => {
    const { unmount } = render(<QuestionDetailView questionId={4} />);
    await waitFor(() => expect(screen.getByText("teacher01")).toBeTruthy());
    // 该回答已被采纳，按钮不出现
    expect(screen.queryByRole("button", { name: "采纳这个回答" })).toBeNull();
    unmount();

    // 换成未采纳的回答 + 非作者身份
    mocks.currentUsername = "other01";
    mocks.fetchQuestionDetail.mockResolvedValue({ ...DETAIL, status: "published", accepted_answer_id: null });
    mocks.fetchAnswers.mockResolvedValue({
      items: [{ ...ANSWER, is_accepted: false }],
      total: 1,
      page: 1,
    });
    render(<QuestionDetailView questionId={4} />);
    await waitFor(() => expect(screen.getByText("teacher01")).toBeTruthy());
    expect(screen.queryByRole("button", { name: "采纳这个回答" })).toBeNull();
  });

  it("投票先乐观更新，失败后回滚并提示", async () => {
    mocks.vote.mockRejectedValue(new Error("network down"));
    render(<QuestionDetailView questionId={4} />);
    await waitFor(() => expect(screen.getByText("3")).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: "赞同（问题票数）" }));

    // 乐观阶段分数立刻 +1
    await waitFor(() => expect(screen.getByText("4")).toBeTruthy());
    // 失败后回滚并给出中文提示
    await waitFor(() => expect(screen.getByText("3")).toBeTruthy());
    expect(screen.getByRole("alert").textContent).toContain("投票失败");
  });

  it("课程负责教师可以对回答做优质内容认证，成功后刷新列表", async () => {
    mocks.fetchCourseDetail.mockResolvedValue({ name: "数据结构", is_owner: true });
    mocks.currentUsername = "teacher01";
    mocks.currentRole = "teacher";
    mocks.certifyAnswer.mockResolvedValue({ answer_id: 1, certified_by_teacher: true });
    render(<QuestionDetailView questionId={4} />);

    // 认证入口要等课程信息（负责教师名）到位后才出现
    const certifyButton = await screen.findByRole("button", { name: "认证优质内容" });
    fireEvent.click(certifyButton);

    await waitFor(() => expect(mocks.certifyAnswer).toHaveBeenCalledWith(1));
    await waitFor(() => expect(mocks.fetchAnswers.mock.calls.length).toBeGreaterThan(1));
    expect(screen.getByText("已认证为优质内容")).toBeTruthy();
  });

  it("非负责教师看不到认证入口（不能只按角色放行）", async () => {
    mocks.currentUsername = "teacher02";
    mocks.currentRole = "teacher";
    render(<QuestionDetailView questionId={4} />);

    await waitFor(() => expect(screen.getByText("teacher01")).toBeTruthy());
    await waitFor(() => expect(mocks.fetchCourseDetail).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: "认证优质内容" })).toBeNull();
  });
});
