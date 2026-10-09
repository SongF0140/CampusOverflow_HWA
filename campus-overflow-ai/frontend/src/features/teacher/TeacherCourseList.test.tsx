import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fetchMyCourses: vi.fn(),
  createCourse: vi.fn(),
  push: vi.fn(),
  role: "teacher",
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock("@/api/courses", () => ({
  fetchMyCourses: mocks.fetchMyCourses,
  createCourse: mocks.createCourse,
}));
vi.mock("@/shared/stores/session-store", () => ({
  useSessionStore: (selector: (state: unknown) => unknown) =>
    selector({ me: { role: mocks.role, username: "teacher01" }, status: "authed", loadMe: vi.fn() }),
}));

import { TeacherCourseList } from "./TeacherCourseList";

const COURSES = [
  {
    id: 1,
    name: "数据结构",
    code: "CS101",
    teacher_name: "teacher01",
    member_count: 12,
    question_count: 5,
    created_at: "",
  },
];

beforeEach(() => {
  mocks.role = "teacher";
  mocks.push.mockReset();
  mocks.fetchMyCourses.mockReset().mockResolvedValue(COURSES);
  mocks.createCourse.mockReset();
});

afterEach(cleanup);

describe("TeacherCourseList", () => {
  it("渲染我的课程，点课程卡进入课程管理，并可展开新建表单", async () => {
    render(<TeacherCourseList />);

    await waitFor(() => expect(screen.getByRole("link", { name: "数据结构" })).toBeTruthy());
    expect(screen.getByRole("link", { name: "数据结构" }).getAttribute("href")).toBe(
      "/teacher/courses/1",
    );
    expect(screen.getByText("12 成员")).toBeTruthy();
    expect(mocks.fetchMyCourses).toHaveBeenCalledWith();

    fireEvent.click(screen.getByRole("button", { name: "＋ 新建课程" }));
    expect(screen.getByPlaceholderText("例如：数据结构")).toBeTruthy();
    expect(screen.getByRole("button", { name: "创建课程" })).toBeTruthy();
  });

  it("非教师角色不渲染新建入口（后端只允许教师创建课程）", async () => {
    mocks.role = "admin";
    render(<TeacherCourseList />);

    await waitFor(() => expect(screen.getByRole("link", { name: "数据结构" })).toBeTruthy());
    expect(screen.queryByRole("button", { name: "＋ 新建课程" })).toBeNull();
  });

  it("没有课程时给出空态与新建入口", async () => {
    mocks.fetchMyCourses.mockResolvedValue([]);
    render(<TeacherCourseList />);

    await waitFor(() => expect(screen.getByText("还没有你负责的课程")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "新建课程" }));
    expect(screen.getByPlaceholderText("例如：数据结构")).toBeTruthy();
  });

  it("非教师角色空列表时说明原因，并给「查看全部课程」入口", async () => {
    mocks.role = "admin";
    mocks.fetchMyCourses.mockResolvedValue([]);
    render(<TeacherCourseList />);

    await waitFor(() => expect(screen.getByText("「我的课程」只显示你任教的课程")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "查看全部课程" }));
    expect(mocks.push).toHaveBeenCalledWith("/courses");
  });

  it("接口失败时给出错误态与重试", async () => {
    mocks.fetchMyCourses.mockRejectedValue(new Error("network down"));
    render(<TeacherCourseList />);

    await waitFor(() => expect(screen.getByText(/课程列表加载失败/)).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "重新加载" }));
    await waitFor(() => expect(mocks.fetchMyCourses.mock.calls.length).toBeGreaterThan(1));
  });
});
