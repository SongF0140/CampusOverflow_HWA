import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ fetchMyCourses: vi.fn(), push: vi.fn() }));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock("@/api/courses", () => ({ fetchMyCourses: mocks.fetchMyCourses }));
vi.mock("@/shared/stores/session-store", () => ({
  useSessionStore: (selector: (state: unknown) => unknown) =>
    selector({ me: { username: "teacher01" }, status: "authed", loadMe: vi.fn() }),
}));

import { TeacherDashboard } from "./TeacherDashboard";

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
  {
    id: 2,
    name: "操作系统",
    code: "CS102",
    teacher_name: "teacher01",
    member_count: 8,
    question_count: 3,
    created_at: "",
  },
];

beforeEach(() => {
  mocks.push.mockReset();
  mocks.fetchMyCourses.mockReset().mockResolvedValue(COURSES);
});

afterEach(cleanup);

describe("TeacherDashboard", () => {
  it("按我教的课程汇总指标，并给出待办入口", async () => {
    render(<TeacherDashboard />);

    await waitFor(() => expect(screen.getByText("2", { selector: "p" })).toBeTruthy());
    expect(mocks.fetchMyCourses).toHaveBeenCalledWith();
    expect(screen.getByRole("link", { name: /我的课程/ }).getAttribute("href")).toBe(
      "/teacher/courses",
    );
    expect(screen.getByRole("link", { name: /优质内容认证/ }).getAttribute("href")).toBe(
      "/teacher/certify",
    );
    expect(screen.getByRole("link", { name: /工单处理/ }).getAttribute("href")).toBe(
      "/teacher/moderation",
    );
  });

  it("没有课程时给出空态与新建入口", async () => {
    mocks.fetchMyCourses.mockResolvedValue([]);
    render(<TeacherDashboard />);

    await waitFor(() => expect(screen.getByText("还没有你负责的课程")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "去新建课程" }));
    expect(mocks.push).toHaveBeenCalledWith("/teacher/courses");
  });

  it("接口失败时给出错误态与重试", async () => {
    mocks.fetchMyCourses.mockRejectedValue(new Error("network down"));
    render(<TeacherDashboard />);

    await waitFor(() => expect(screen.getByText(/工作台数据加载失败/)).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "重新加载" }));
    await waitFor(() => expect(mocks.fetchMyCourses.mock.calls.length).toBeGreaterThan(1));
  });
});
