import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fetchCourseDetail: vi.fn(),
  joinCourse: vi.fn(),
  leaveCourse: vi.fn(),
  fetchQuestionList: vi.fn(),
  load: vi.fn(),
  role: "student",
  username: "student01",
}));

vi.mock("@/api/courses", () => ({
  fetchCourseDetail: mocks.fetchCourseDetail,
  joinCourse: mocks.joinCourse,
  leaveCourse: mocks.leaveCourse,
}));
vi.mock("@/api/questions", () => ({ fetchQuestionList: mocks.fetchQuestionList }));
vi.mock("@/shared/stores/session-store", () => ({
  useSessionStore: (selector: (state: unknown) => unknown) =>
    selector({
      user: { role: mocks.role, username: mocks.username },
      status: "ready",
      load: mocks.load,
    }),
}));

import { CourseDetailView } from "./CourseDetailView";

const DETAIL = {
  id: 1,
  name: "数据结构",
  code: "CS101",
  description: "线性表、树与图。",
  semester: "2026 秋",
  teacher_name: "teacher01",
  joined: false,
  aggregates: {
    hot_questions: [{ id: 101, title: "红黑树的删除操作" }],
    // 后端当前返回与热门问题同一份列表
    frequent_questions: [{ id: 101, title: "红黑树的删除操作" }],
    tags: [{ id: 1, name: "红黑树", type: "tech", question_count: 3 }],
    active_users: [{ user_id: 11, username: "student01", activity_count: 5 }],
  },
  created_at: "2026-09-01T00:00:00+08:00",
};

beforeEach(() => {
  mocks.role = "student";
  mocks.username = "student01";
  mocks.fetchCourseDetail.mockReset().mockResolvedValue(DETAIL);
  mocks.joinCourse.mockReset().mockResolvedValue({ joined: true });
  mocks.leaveCourse.mockReset().mockResolvedValue({ joined: false });
  mocks.fetchQuestionList.mockReset().mockResolvedValue({
    items: [],
    total: 0,
    page: 1,
    page_size: 20,
  });
  mocks.load.mockReset().mockResolvedValue(undefined);
});

afterEach(cleanup);

describe("CourseDetailView", () => {
  it("渲染课程信息与聚合区块；未加入时不显示提问入口", async () => {
    render(<CourseDetailView courseId={1} />);

    await waitFor(() => expect(screen.getByRole("heading", { name: "数据结构" })).toBeTruthy());
    expect(screen.getByText("授课：teacher01")).toBeTruthy();
    expect(screen.getByText("红黑树")).toBeTruthy();
    expect(screen.getByRole("link", { name: "student01" }).getAttribute("href")).toBe("/users/11");
    // 与热门问题重复的高频问题不重复渲染
    expect(screen.queryByRole("heading", { name: "高频问题" })).toBeNull();
    expect(screen.queryByRole("link", { name: "我要提问" })).toBeNull();
    expect(screen.getByRole("button", { name: "加入课程" })).toBeTruthy();
  });

  it("加入课程后出现提问入口与退出按钮", async () => {
    render(<CourseDetailView courseId={1} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "加入课程" })).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: "加入课程" }));

    await waitFor(() => expect(mocks.joinCourse).toHaveBeenCalledWith(1));
    expect(await screen.findByRole("button", { name: "退出课程" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "我要提问" }).getAttribute("href")).toBe(
      "/questions/new?course_id=1",
    );
  });

  it("退出课程需要二次确认", async () => {
    mocks.fetchCourseDetail.mockResolvedValue({ ...DETAIL, joined: true });
    render(<CourseDetailView courseId={1} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "退出课程" })).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: "退出课程" }));
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(mocks.leaveCourse).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "确认退出" }));
    await waitFor(() => expect(mocks.leaveCourse).toHaveBeenCalledWith(1));
  });

  it("非学生角色不渲染加入/退出入口（后端仅允许学生加入）", async () => {
    mocks.role = "teacher";
    render(<CourseDetailView courseId={1} />);

    await waitFor(() => expect(screen.getByRole("heading", { name: "数据结构" })).toBeTruthy());
    expect(screen.queryByRole("button", { name: "加入课程" })).toBeNull();
    expect(screen.queryByRole("button", { name: "退出课程" })).toBeNull();
  });

  it("课程负责教师未加入也能看到提问入口（后端允许负责教师直接发布）", async () => {
    mocks.role = "teacher";
    mocks.username = "teacher01"; // 与课程详情里的 teacher_name 一致 = 负责教师
    render(<CourseDetailView courseId={1} />);

    await waitFor(() => expect(screen.getByRole("heading", { name: "数据结构" })).toBeTruthy());
    expect(screen.getByRole("link", { name: "我要提问" }).getAttribute("href")).toBe(
      "/questions/new?course_id=1",
    );
    expect(screen.queryByText(/加入课程后可以在这门课程下提问/)).toBeNull();
    expect(screen.queryByRole("button", { name: "加入课程" })).toBeNull();
  });

  it("非负责教师没有提问入口（不能只按 role === teacher 放行）", async () => {
    mocks.role = "teacher";
    mocks.username = "teacher02"; // 不是这门课的负责教师
    render(<CourseDetailView courseId={1} />);

    await waitFor(() => expect(screen.getByRole("heading", { name: "数据结构" })).toBeTruthy());
    expect(screen.queryByRole("link", { name: "我要提问" })).toBeNull();
    expect(screen.getByText(/加入课程后可以在这门课程下提问/)).toBeTruthy();
  });

  it("URL 里的筛选条件回填到问答区（返回/刷新不丢筛选）", async () => {
    render(<CourseDetailView courseId={1} initialKeyword="E2E" initialSort="hot" initialUnresolved />);

    await waitFor(() =>
      expect(mocks.fetchQuestionList).toHaveBeenCalledWith(
        expect.objectContaining({
          course_id: 1,
          keyword: "E2E",
          sort: "hot",
          unresolved: true,
        }),
      ),
    );
  });
});
