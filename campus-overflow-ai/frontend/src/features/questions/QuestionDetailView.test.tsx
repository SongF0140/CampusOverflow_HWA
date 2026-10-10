import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
  fetchUserAnswers: vi.fn(),
  fetchUserQuestions: vi.fn(),
  recommendAnswer: vi.fn(),
  currentUsername: "student01",
  currentRole: "student",
  currentIdentity: "undergraduate",
  currentCert: "none",
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
vi.mock("@/api/answers", () => ({ recommendAnswer: mocks.recommendAnswer }));
vi.mock("@/api/users", () => ({ fetchUserAnswers: mocks.fetchUserAnswers, fetchUserQuestions: mocks.fetchUserQuestions }));
vi.mock("@/shared/stores/session-store", () => ({
  useSessionStore: (
    selector: (state: {
      me: {
        username: string;
        role: string;
        identity_type: string;
        assistant_cert_status: string;
      } | null;
      loadMe: () => Promise<void>;
    }) => unknown,
  ) =>
    selector({
      me: mocks.currentUsername
        ? {
            username: mocks.currentUsername,
            role: mocks.currentRole,
            identity_type: mocks.currentIdentity,
            assistant_cert_status: mocks.currentCert,
          }
        : null,
      loadMe: noopLoad,
    }),
}));

import { QuestionDetailView } from "./QuestionDetailView";
import { ProfileContent } from "@/features/users/ProfileContent";

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
  window.history.replaceState(null, "", "/questions/4");
  mocks.currentUsername = "student01";
  mocks.currentRole = "student";
  mocks.currentIdentity = "undergraduate";
  mocks.currentCert = "none";
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
  mocks.fetchUserAnswers.mockReset();
  mocks.fetchUserQuestions.mockReset();
  mocks.recommendAnswer.mockReset().mockResolvedValue({ recommended_by_assistant: true });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function pagedAnswers(count = 25) {
  mocks.fetchAnswers.mockImplementation(async (_id: number, _sort: string, page = 1) => ({
    items: Array.from({ length: Math.max(0, Math.min(20, count - (page - 1) * 20)) }, (_, index) => {
      const id = (page - 1) * 20 + index + 1;
      return { ...ANSWER, id, body: `回答正文 ${id}` };
    }),
    total: count, page,
  }));
}

describe("QuestionDetailView", () => {
  it("点击用户主页旧回答链接后，在实际详情组件中可达目标回答", async () => {
    pagedAnswers();
    mocks.fetchUserAnswers.mockResolvedValue({
      items: [{ ...ANSWER, id: 25, question_id: 4, question_title: "旧回答的问题" }],
      total: 1, page: 1, page_size: 10,
    });
    // 单测模拟路由导航，使用真实主页链接与实际详情组件，不止断言 href。
    const profile = render(<ProfileContent userId={7} tab="answers" />);
    const link = await screen.findByRole("link", { name: "旧回答的问题" });
    link.addEventListener("click", (event) => {
      event.preventDefault();
      window.history.pushState(null, "", link.getAttribute("href"));
    });
    fireEvent.click(link);
    profile.unmount();
    render(<QuestionDetailView questionId={4} />);
    await screen.findByText("回答正文 25");
    expect(document.getElementById("answer-25")).toBeTruthy();
    expect(mocks.fetchAnswers).toHaveBeenCalledWith(4, "latest", 2, 20);
  });

  it("旧回答锚点加载第二页真实卡片后滚动定位，并展示真实总数", async () => {
    pagedAnswers();
    const scroll = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { value: scroll, configurable: true });
    window.history.replaceState(null, "", "/questions/4#answer-25");
    render(<QuestionDetailView questionId={4} />);
    await screen.findByText("回答正文 25");
    expect(document.getElementById("answer-25")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "25 个回答" })).toBeTruthy();
    expect(mocks.fetchAnswers).toHaveBeenCalledWith(4, "latest", 2, 20);
    await waitFor(() => expect(scroll).toHaveBeenCalled());
    expect(screen.queryByText("回答正文 1")).toBeNull();
    expect(screen.getByRole("button", { name: "2", current: "page" })).toBeTruthy();
  });

  it("普通分页可访问后20条回答，切排序回第一页且不重复读取问题详情", async () => {
    pagedAnswers();
    render(<QuestionDetailView questionId={4} />);
    await screen.findByText("回答正文 1");
    fireEvent.click(screen.getByRole("button", { name: "下一页" }));
    await screen.findByText("回答正文 25");
    fireEvent.click(screen.getByRole("button", { name: "票数" }));
    await screen.findByText("回答正文 1");
    expect(mocks.fetchAnswers).toHaveBeenCalledWith(4, "votes", 1, 20);
    expect(mocks.fetchQuestionDetail).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("回答正文 25")).toBeNull();
  });

  it("缺失或已删除目标穷尽分页后明确提示，保留可浏览的第一页", async () => {
    pagedAnswers();
    window.history.replaceState(null, "", "/questions/4#answer-999");
    render(<QuestionDetailView questionId={4} />);
    await screen.findByText("目标回答不存在或已删除，已显示第一页回答。");
    expect(screen.getByText("回答正文 1")).toBeTruthy();
    expect(mocks.fetchAnswers).toHaveBeenCalledTimes(2);
  });

  it("同页锚点变化定位新目标，手动翻页清除旧回答锚点避免被拉回", async () => {
    pagedAnswers();
    render(<QuestionDetailView questionId={4} />);
    await screen.findByText("回答正文 1");
    act(() => {
      window.history.replaceState(null, "", "/questions/4#answer-25");
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
    await screen.findByText("回答正文 25");
    fireEvent.click(screen.getByRole("button", { name: "上一页" }));
    await screen.findByText("回答正文 1");
    expect(window.location.hash).toBe("");
    expect(screen.queryByText("回答正文 25")).toBeNull();
  });

  it("定位请求失败不是缺失回答，保留锚点并允许重试", async () => {
    pagedAnswers();
    const original = mocks.fetchAnswers.getMockImplementation()!;
    mocks.fetchAnswers.mockImplementationOnce(original).mockRejectedValueOnce(new Error("网络故障"));
    window.history.replaceState(null, "", "/questions/4#answer-25");
    render(<QuestionDetailView questionId={4} />);
    await screen.findByText("回答加载失败，请稍后重试。");
    expect(screen.queryByText("目标回答不存在或已删除，已显示第一页回答。")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "重新加载" }));
    await screen.findByText("回答正文 25");
  });

  it("问题切换后旧定位响应不能覆盖新问题回答", async () => {
    let resolveOld!: (value: { items: typeof ANSWER[]; total: number; page: number }) => void;
    mocks.fetchAnswers.mockImplementation(async (id: number, _sort: string, page: number) => {
      if (id === 4 && page === 2) return new Promise((resolve) => { resolveOld = resolve; });
      return { items: [{ ...ANSWER, id: id === 4 ? 1 : 30, body: `问题 ${id} 的回答` }], total: id === 4 ? 25 : 1, page: 1 };
    });
    mocks.fetchQuestionDetail.mockImplementation(async (id: number) => ({ ...DETAIL, id }));
    window.history.replaceState(null, "", "/questions/4#answer-25");
    const view = render(<QuestionDetailView questionId={4} />);
    await waitFor(() => expect(resolveOld).toBeTypeOf("function"));
    window.history.replaceState(null, "", "/questions/5");
    view.rerender(<QuestionDetailView questionId={5} />);
    await screen.findByText("问题 5 的回答");
    await act(async () => resolveOld({ items: [{ ...ANSWER, id: 25, body: "过期回答" }], total: 25, page: 2 }));
    expect(screen.queryByText("过期回答")).toBeNull();
    expect(screen.getByText("问题 5 的回答")).toBeTruthy();
  });

  it("空页或非法锚点不会无限扫描或伪造总数", async () => {
    mocks.fetchAnswers.mockResolvedValue({ items: [], total: 0, page: 1 });
    window.history.replaceState(null, "", "/questions/4#answer-0");
    render(<QuestionDetailView questionId={4} />);
    await screen.findByText("还没有人回答");
    expect(screen.getByRole("heading", { name: "0 个回答" })).toBeTruthy();
    expect(mocks.fetchAnswers).toHaveBeenCalledTimes(1);
  });

  it("目标超过20个分页仍可达，不静默截断扫描", async () => {
    pagedAnswers(401);
    window.history.replaceState(null, "", "/questions/4#answer-401");
    render(<QuestionDetailView questionId={4} />);
    await screen.findByText("回答正文 401");
    expect(mocks.fetchAnswers).toHaveBeenCalledTimes(21);
    expect(mocks.fetchAnswers).toHaveBeenLastCalledWith(4, "latest", 21, 20);
    expect(screen.getByRole("heading", { name: "401 个回答" })).toBeTruthy();
  });

  it("定位期间空页立即停止，避免变化中的列表无限请求", async () => {
    mocks.fetchAnswers.mockResolvedValue({ items: [], total: 25, page: 1 });
    window.history.replaceState(null, "", "/questions/4#answer-25");
    render(<QuestionDetailView questionId={4} />);
    await screen.findByText("目标回答不存在或已删除，已显示第一页回答。");
    expect(mocks.fetchAnswers).toHaveBeenCalledTimes(1);
  });

  it("排序变化取消旧定位扫描并按新排序定位目标", async () => {
    let resolveOld!: (value: { items: typeof ANSWER[]; total: number; page: number }) => void;
    mocks.fetchAnswers.mockImplementation(async (_id: number, sort: string, page: number) => {
      if (sort === "latest" && page === 2) return new Promise((resolve) => { resolveOld = resolve; });
      return { items: [{ ...ANSWER, id: sort === "votes" ? 25 : 1, body: `${sort} 回答` }], total: 25, page: 1 };
    });
    window.history.replaceState(null, "", "/questions/4#answer-25");
    render(<QuestionDetailView questionId={4} />);
    await waitFor(() => expect(resolveOld).toBeTypeOf("function"));
    fireEvent.click(screen.getByRole("button", { name: "票数" }));
    await screen.findByText("votes 回答");
    await act(async () => resolveOld({ items: [{ ...ANSWER, id: 25, body: "旧排序结果" }], total: 25, page: 2 }));
    expect(screen.queryByText("旧排序结果")).toBeNull();
    expect(document.getElementById("answer-25")).toBeTruthy();
  });

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

  it("助教能力位（研究生 + 认证通过）才出现推荐入口，点击后调用 recommend", async () => {
    mocks.currentIdentity = "postgraduate";
    mocks.currentCert = "approved";
    render(<QuestionDetailView questionId={4} />);

    const recommendButton = await screen.findByRole("button", { name: "标记推荐" });
    fireEvent.click(recommendButton);

    await waitFor(() => expect(mocks.recommendAnswer).toHaveBeenCalledWith(1, true));
    expect(await screen.findByText("已标记为助教推荐")).toBeTruthy();
  });

  it("普通学生（E-12）不出现推荐入口", async () => {
    render(<QuestionDetailView questionId={4} />);

    await waitFor(() => expect(screen.getByText("teacher01")).toBeTruthy());
    expect(screen.queryByRole("button", { name: "标记推荐" })).toBeNull();
  });
});
