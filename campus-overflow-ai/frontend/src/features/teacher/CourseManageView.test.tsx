import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fetchCourseDetail: vi.fn(),
  fetchCourseMembers: vi.fn(),
  fetchQuestionList: vi.fn(),
  fetchCourseNameMap: vi.fn(),
  role: "teacher",
  username: "teacher01",
}));

vi.mock("@/api/courses", () => ({
  fetchCourseDetail: mocks.fetchCourseDetail,
  fetchCourseMembers: mocks.fetchCourseMembers,
  fetchCourseNameMap: mocks.fetchCourseNameMap,
}));
vi.mock("@/api/questions", () => ({ fetchQuestionList: mocks.fetchQuestionList }));
vi.mock("@/shared/stores/session-store", () => ({
  useSessionStore: (selector: (state: unknown) => unknown) =>
    selector({
      user: { role: mocks.role, username: mocks.username },
      status: "ready",
      load: vi.fn(),
    }),
}));

import { CourseManageView } from "./CourseManageView";

const DETAIL = {
  id: 1,
  name: "数据结构",
  code: "CS101",
  description: "线性表、树与图",
  semester: "2026秋",
  teacher_name: "teacher01",
  joined: false,
  aggregates: {
    hot_questions: [],
    frequent_questions: [],
    tags: [{ id: 1, name: "红黑树", type: "tech", question_count: 3 }],
    active_users: [],
  },
  created_at: "",
};

beforeEach(() => {
  mocks.role = "teacher";
  mocks.username = "teacher01";
  mocks.fetchCourseDetail.mockReset().mockResolvedValue(DETAIL);
  mocks.fetchCourseMembers.mockReset().mockResolvedValue({
    items: [{ user_id: 11, username: "student01", joined_at: "2026-10-04T14:24:05+08:00" }],
    total: 1,
    page: 1,
    page_size: 20,
  });
  mocks.fetchQuestionList.mockReset().mockResolvedValue({
    items: [],
    total: 0,
    page: 1,
    page_size: 20,
  });
  mocks.fetchCourseNameMap.mockReset().mockResolvedValue({ 1: "数据结构" });
});

afterEach(cleanup);

describe("CourseManageView", () => {
  it("负责教师：四个 Tab 都在，默认问题 Tab，并可跨端查看", async () => {
    render(<CourseManageView courseId={1} />);

    await waitFor(() => expect(screen.getByRole("heading", { name: "数据结构" })).toBeTruthy());
    for (const label of ["问题", "成员", "标签", "设置"]) {
      expect(screen.getByRole("button", { name: label })).toBeTruthy();
    }
    expect(screen.getByRole("link", { name: /跨端查看/ }).getAttribute("href")).toBe("/courses/1");
    // 默认问题 Tab：走课程问题列表接口
    await waitFor(() =>
      expect(mocks.fetchQuestionList).toHaveBeenCalledWith(
        expect.objectContaining({ course_id: 1, page: 1 }),
      ),
    );
  });

  it("切到成员 Tab 时才拉成员；切到标签 Tab 展示聚合标签", async () => {
    render(<CourseManageView courseId={1} />);
    await waitFor(() => expect(screen.getByRole("heading", { name: "数据结构" })).toBeTruthy());
    expect(mocks.fetchCourseMembers).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "成员" }));
    await waitFor(() => expect(mocks.fetchCourseMembers).toHaveBeenCalledWith(1, { page: 1, page_size: 20 }));
    expect(await screen.findByText("student01")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "标签" }));
    expect(screen.getByText("红黑树（3）")).toBeTruthy();
    expect(screen.getByRole("link", { name: /红黑树/ }).getAttribute("href")).toBe("/tags/1");
  });

  it("设置 Tab 复用课程表单（编码只读）", async () => {
    render(<CourseManageView courseId={1} />);
    await waitFor(() => expect(screen.getByRole("heading", { name: "数据结构" })).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: "设置" }));
    expect(screen.getByText(/编码是课程标识，不可修改/)).toBeTruthy();
    expect((screen.getByPlaceholderText("例如：数据结构") as HTMLInputElement).value).toBe("数据结构");
    expect(screen.getByDisplayValue("线性表、树与图")).toBeTruthy();
  });

  it("非负责教师看到无权限提示，且不发任何业务请求", async () => {
    mocks.username = "teacher02"; // 不是这门课的负责教师
    render(<CourseManageView courseId={1} />);

    await waitFor(() => expect(screen.getByText("你当前的角色没有访问权限")).toBeTruthy());
    expect(screen.queryByRole("button", { name: "成员" })).toBeNull();
    expect(mocks.fetchQuestionList).not.toHaveBeenCalled();
    expect(mocks.fetchCourseMembers).not.toHaveBeenCalled();
  });

  it("管理员可以管理非本人课程", async () => {
    mocks.role = "admin";
    mocks.username = "admin01";
    render(<CourseManageView courseId={1} />);

    await waitFor(() => expect(screen.getByRole("heading", { name: "数据结构" })).toBeTruthy());
    expect(screen.getByRole("button", { name: "设置" })).toBeTruthy();
  });

  it("URL 里的 tab 会被回填（从成员页返回不丢当前 Tab）", async () => {
    render(<CourseManageView courseId={1} initialTab="members" />);

    const membersTab = await screen.findByRole("button", { name: "成员" });
    expect(membersTab.getAttribute("aria-pressed")).toBe("true");
    await waitFor(() => expect(mocks.fetchCourseMembers).toHaveBeenCalledWith(1, { page: 1, page_size: 20 }));
    expect(window.location.search).toContain("tab=members");
    window.history.replaceState(null, "", "/");
  });
});
