import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCourse: vi.fn(),
  joinCourse: vi.fn(),
  leaveCourse: vi.fn(),
  listCourseQuestions: vi.fn(),
  push: vi.fn(),
  redirectToLogin: vi.fn(),
  // session-store 以可变对象模拟，按用例切换登录态
  session: { status: "authed", me: null as { role: string } | null },
}));

vi.mock("@/api/courses", () => ({
  getCourse: mocks.getCourse,
  joinCourse: mocks.joinCourse,
  leaveCourse: mocks.leaveCourse,
  listCourseQuestions: mocks.listCourseQuestions,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push, replace: vi.fn(), prefetch: vi.fn() }),
}));

vi.mock("@/shared/stores/session-store", () => ({
  useSessionStore: (selector: (state: typeof mocks.session) => unknown) =>
    selector(mocks.session),
}));

vi.mock("@/shared/utils/navigation", () => ({
  currentPath: () => "/courses/7",
  redirectToLogin: mocks.redirectToLogin,
}));

import { ApiError } from "@/api/client";
import type { CourseDetail } from "@/shared/types/course";
import type { Paged } from "@/shared/types/common";
import type { QuestionListItem } from "@/shared/types/question";

import { CourseDetailView } from "./CourseDetailView";

const HOT_QUESTION: QuestionListItem = {
  id: 103,
  title: "TCP 三次握手为什么不能改成两次？",
  course_id: 7,
  author: "赵同学",
  tags: [{ id: 5, name: "TCP", type: "tech" }],
  status: "resolved",
  vote_score: 47,
  my_vote: 0,
  answer_count: 8,
  view_count: 1520,
  has_accepted: true,
  created_at: "2026-10-02T14:05:00+08:00",
};

const QA_QUESTIONS: QuestionListItem[] = [
  {
    id: 201,
    title: "子网掩码和 CIDR 的表示法怎么互相换算？",
    course_id: 7,
    author: "吴同学",
    tags: [{ id: 5, name: "TCP", type: "tech" }],
    status: "unresolved",
    vote_score: 9,
    my_vote: 0,
    answer_count: 2,
    view_count: 173,
    has_accepted: false,
    created_at: "2026-09-30T11:20:00+08:00",
  },
  {
    id: 202,
    title: "滑动窗口流量控制该怎么理解？",
    course_id: 7,
    author: "孙同学",
    tags: [],
    status: "unresolved",
    vote_score: 3,
    my_vote: 0,
    answer_count: 1,
    view_count: 64,
    has_accepted: false,
    created_at: "2026-09-29T09:00:00+08:00",
  },
];

const EMPTY_AGGREGATES = {
  hot_questions: [],
  frequent_questions: [],
  tags: [],
  active_users: [],
};

function makeDetail(overrides: Partial<CourseDetail> = {}): CourseDetail {
  return {
    id: 7,
    name: "计算机网络",
    code: "CS301",
    description: "### 课程简介\n覆盖 TCP/IP 协议栈。",
    semester: "2026-秋",
    teacher_name: "李老师",
    joined: false,
    aggregates: {
      hot_questions: [HOT_QUESTION],
      frequent_questions: [HOT_QUESTION],
      tags: [{ id: 5, name: "TCP", type: "tech", question_count: 9 }],
      active_users: [{ user_id: 11, username: "赵同学", activity_count: 8 }],
    },
    created_at: "2026-09-01T08:00:00+08:00",
    ...overrides,
  };
}

function makeQuestionPage(
  items: QuestionListItem[],
  total = items.length,
  page = 1,
): Paged<QuestionListItem> {
  return { items, total, page, page_size: 10 };
}

function setSession(status: string, me: { role: string } | null) {
  mocks.session.status = status;
  mocks.session.me = me;
}

function renderDetail(props?: { initialSort?: "latest" | "hot"; initialPage?: number }) {
  return render(
    <CourseDetailView
      courseId={7}
      initialSort={props?.initialSort ?? "latest"}
      initialPage={props?.initialPage ?? 1}
    />,
  );
}

beforeEach(() => {
  mocks.getCourse.mockReset();
  mocks.joinCourse.mockReset();
  mocks.leaveCourse.mockReset();
  mocks.listCourseQuestions.mockReset();
  mocks.push.mockReset();
  mocks.redirectToLogin.mockReset();
  mocks.joinCourse.mockResolvedValue({ joined: true });
  mocks.leaveCourse.mockResolvedValue({ joined: false });
  mocks.listCourseQuestions.mockResolvedValue(makeQuestionPage(QA_QUESTIONS, 12));
  window.history.replaceState(null, "", "/courses/7");
});

afterEach(cleanup);

describe("CourseDetailView", () => {
  it("渲染课程头卡与四聚合区块（高频问题/标签/活跃用户）", async () => {
    setSession("authed", { role: "student" });
    mocks.getCourse.mockResolvedValue(makeDetail());
    renderDetail();

    expect(await screen.findByRole("heading", { name: "计算机网络" })).toBeTruthy();
    expect(screen.getByText("授课教师 · 李老师")).toBeTruthy();
    expect(screen.getByText("学期 · 2026-秋")).toBeTruthy();
    // 简介 MarkdownView 渲染出 h3 标题
    expect(screen.getByRole("heading", { name: "课程简介" })).toBeTruthy();
    // 高频问题：紧凑标题链接 → /questions/[id]
    const hotLink = screen.getByRole("link", { name: HOT_QUESTION.title });
    expect(hotLink.getAttribute("href")).toBe("/questions/103");
    expect(screen.getByText("47 票 · 8 回答")).toBeTruthy();
    // 活跃用户：UserLine + 动态数
    expect(screen.getByText("赵同学")).toBeTruthy();
    expect(screen.getByText("8 条动态")).toBeTruthy();
    // 本课程常用标签：点击跳标签详情
    fireEvent.click(screen.getByRole("button", { name: "TCP" }));
    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith("/tags/5"));
    // 问答区复用问题卡渲染课程问题
    expect(screen.getByText("子网掩码和 CIDR 的表示法怎么互相换算？")).toBeTruthy();
    expect(screen.getByRole("tab", { selected: true }).textContent).toBe("最新");
  });

  it("聚合为空数组时隐藏对应区块", async () => {
    setSession("authed", { role: "student" });
    mocks.getCourse.mockResolvedValue(makeDetail({ aggregates: EMPTY_AGGREGATES }));
    renderDetail();

    await screen.findByRole("heading", { name: "计算机网络" });
    expect(screen.queryByText("高频问题")).toBeNull();
    expect(screen.queryByText("活跃用户")).toBeNull();
    expect(screen.queryByText("本课程常用标签")).toBeNull();
  });

  it("未加入学生点击加入：调 join 接口、Toast 提示并重拉详情联动按钮", async () => {
    setSession("authed", { role: "student" });
    mocks.getCourse
      .mockResolvedValueOnce(makeDetail({ joined: false }))
      .mockResolvedValue(makeDetail({ joined: true }));
    renderDetail();

    fireEvent.click(await screen.findByRole("button", { name: "加入课程" }));

    await waitFor(() => expect(mocks.joinCourse).toHaveBeenCalledWith(7));
    await screen.findByText("已加入课程");
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "退出课程" })).toBeTruthy();
      expect(screen.queryByRole("button", { name: "加入课程" })).toBeNull();
    });
    expect(mocks.getCourse).toHaveBeenCalledTimes(2);
  });

  it("已加入学生退出课程需二次确认，确认后调 leave 接口", async () => {
    setSession("authed", { role: "student" });
    mocks.getCourse.mockResolvedValue(makeDetail({ joined: true }));
    renderDetail();

    fireEvent.click(await screen.findByRole("button", { name: "退出课程" }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("退出后需重新加入，确定要退出当前课程吗？")).toBeTruthy();

    fireEvent.click(within(dialog).getByRole("button", { name: "退出课程" }));

    await waitFor(() => expect(mocks.leaveCourse).toHaveBeenCalledWith(7));
    await screen.findByText("已退出课程");
  });

  it("教师与管理员不显示加入/退出按钮", async () => {
    setSession("authed", { role: "teacher" });
    mocks.getCourse.mockResolvedValue(makeDetail({ joined: false }));
    renderDetail();

    await screen.findByRole("heading", { name: "计算机网络" });
    expect(screen.queryByRole("button", { name: "加入课程" })).toBeNull();
    expect(screen.queryByRole("button", { name: "退出课程" })).toBeNull();
    // 教师仍可进入问答区
    expect(screen.getByRole("button", { name: "进入问答区↓" })).toBeTruthy();
  });

  it("游客点击加入课程引导登录", async () => {
    setSession("guest", null);
    mocks.getCourse.mockResolvedValue(makeDetail({ joined: false }));
    renderDetail();

    fireEvent.click(await screen.findByRole("button", { name: "加入课程" }));

    expect(mocks.redirectToLogin).toHaveBeenCalled();
    expect(mocks.joinCourse).not.toHaveBeenCalled();
  });

  it("课程不存在（404）时展示空删除态并返回课程列表", async () => {
    setSession("authed", { role: "student" });
    mocks.getCourse.mockRejectedValue(new ApiError(404, "课程不存在"));
    renderDetail();

    expect(await screen.findByText("课程不存在或已删除")).toBeTruthy();
    const backLink = screen.getByRole("link", { name: "返回课程列表" });
    expect(backLink.getAttribute("href")).toBe("/courses");
  });

  it("详情加载失败展示错误状态并可重试", async () => {
    setSession("authed", { role: "student" });
    mocks.getCourse
      .mockRejectedValueOnce(new ApiError(500, "服务暂时不可用，请稍后重试"))
      .mockResolvedValueOnce(makeDetail());
    renderDetail();

    expect(await screen.findByRole("alert")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "重新加载" }));

    await screen.findByRole("heading", { name: "计算机网络" });
  });

  it("游客访问详情（401）展示登录引导", async () => {
    setSession("guest", null);
    mocks.getCourse.mockRejectedValue(new ApiError(401, "未登录或登录已过期"));
    renderDetail();

    expect(await screen.findByText("登录后查看课程详情")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "去登录" }));
    expect(mocks.redirectToLogin).toHaveBeenCalled();
  });

  it("我要提问：登录学生跳转发布页并预填课程", async () => {
    setSession("authed", { role: "student" });
    mocks.getCourse.mockResolvedValue(makeDetail());
    renderDetail();

    fireEvent.click(await screen.findByRole("button", { name: "我要提问" }));

    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith("/questions/new?course_id=7"));
  });

  it("我要提问：游客引导登录而非跳转发布页", async () => {
    setSession("guest", null);
    mocks.getCourse.mockResolvedValue(makeDetail());
    renderDetail();

    fireEvent.click(await screen.findByRole("button", { name: "我要提问" }));

    await waitFor(() => expect(mocks.redirectToLogin).toHaveBeenCalled());
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it("切换热门排序以 sort=hot 重拉并写入 URL", async () => {
    setSession("authed", { role: "student" });
    mocks.getCourse.mockResolvedValue(makeDetail());
    renderDetail();

    await screen.findByText("子网掩码和 CIDR 的表示法怎么互相换算？");
    fireEvent.click(screen.getByRole("tab", { name: "热门" }));

    await waitFor(() => {
      expect(mocks.listCourseQuestions).toHaveBeenLastCalledWith(
        7,
        expect.objectContaining({ sort: "hot", page: 1 }),
      );
      expect(window.location.search).toBe("?sort=hot");
    });
  });

  it("问答区分页写 URL，下一页以 page=2 重拉", async () => {
    setSession("authed", { role: "student" });
    mocks.getCourse.mockResolvedValue(makeDetail());
    renderDetail();

    await screen.findByText("子网掩码和 CIDR 的表示法怎么互相换算？");
    fireEvent.click(screen.getByRole("button", { name: "下一页" }));

    await waitFor(() => {
      expect(mocks.listCourseQuestions).toHaveBeenLastCalledWith(
        7,
        expect.objectContaining({ page: 2 }),
      );
      expect(window.location.search).toBe("?page=2");
    });
  });

  it("URL 参数回填：初始 sort=hot、page=2 时直接以该参数请求", async () => {
    setSession("authed", { role: "student" });
    mocks.getCourse.mockResolvedValue(makeDetail());
    renderDetail({ initialSort: "hot", initialPage: 2 });

    await waitFor(() =>
      expect(mocks.listCourseQuestions).toHaveBeenCalledWith(
        7,
        expect.objectContaining({ sort: "hot", page: 2, page_size: 10 }),
      ),
    );
    expect(screen.getByRole("tab", { name: "热门" }).getAttribute("aria-selected")).toBe("true");
  });
});
