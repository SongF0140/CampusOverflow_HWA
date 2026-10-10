import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fetchCourseDetail: vi.fn(),
  updateCourse: vi.fn(),
  listCourseMembers: vi.fn(),
  listCourseQuestions: vi.fn(),
  listAssistantCertifications: vi.fn(),
  role: "teacher",
}));

vi.mock("@/api/courses", () => ({
  fetchCourseDetail: mocks.fetchCourseDetail,
  updateCourse: mocks.updateCourse,
  listCourseMembers: mocks.listCourseMembers,
  listCourseQuestions: mocks.listCourseQuestions,
}));
vi.mock("@/api/users", () => ({
  listAssistantCertifications: mocks.listAssistantCertifications,
  reviewAssistantCertification: vi.fn(),
}));
vi.mock("@/shared/stores/session-store", () => ({
  useSessionStore: (selector: (state: unknown) => unknown) =>
    selector({
      me: { role: mocks.role, username: "teacher01" },
      status: "authed",
      loadMe: vi.fn(),
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
  is_owner: true,
  can_post: true,
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
  mocks.fetchCourseDetail.mockReset().mockResolvedValue(DETAIL);
  mocks.updateCourse.mockReset().mockResolvedValue({ data: { id: 1 }, message: "课程更新成功" });
  mocks.listCourseMembers.mockReset().mockResolvedValue({
    items: [{ user_id: 11, username: "student01", joined_at: "2026-10-04T14:24:05+08:00" }],
    total: 1,
    page: 1,
    page_size: 10,
  });
  mocks.listCourseQuestions.mockReset().mockResolvedValue({
    items: [],
    total: 0,
    page: 1,
    page_size: 10,
  });
  mocks.listAssistantCertifications.mockReset().mockResolvedValue({
    items: [],
    total: 0,
    page: 1,
    page_size: 20,
  });
});

afterEach(cleanup);

describe("CourseManageView", () => {
  it("负责教师：四个 Tab + 跨端查看 + 编辑/删除入口（§3.3）", async () => {
    render(<CourseManageView courseId={1} />);

    await waitFor(() => expect(screen.getByRole("heading", { name: "数据结构" })).toBeTruthy());
    for (const label of ["问题", "成员", "标签", "设置"]) {
      expect(screen.getByRole("tab", { name: label })).toBeTruthy();
    }
    expect(screen.getByRole("link", { name: /跨端查看/ }).getAttribute("href")).toBe("/courses/1");
    expect(screen.getByRole("button", { name: "编辑课程" })).toBeTruthy();
    // 后端无 DELETE /api/courses/{id} → 删除入口禁用并说明，不做假成功
    expect((screen.getByRole("button", { name: "删除课程" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  // 评审要求：助教认证审核不再绑在单门课程详情里（全局流程不该依赖某门课程的管理权限）
  it("课程管理页不再渲染助教审核板块", async () => {
    render(<CourseManageView courseId={1} />);

    // 课程名同时出现在面包屑与标题里，用 findAll 避免"多个匹配"报错
    expect((await screen.findAllByText("数据结构")).length).toBeGreaterThan(0);
    expect(screen.queryByText("助教板块 · 认证审核")).toBeNull();
  });

  it("默认问题 Tab 拉课程问题列表", async () => {
    render(<CourseManageView courseId={1} />);

    await waitFor(() =>
      expect(mocks.listCourseQuestions).toHaveBeenCalledWith(1, expect.objectContaining({ page: 1 })),
    );
  });

  it("切成员 Tab 才拉成员，并显示角色列与移出入口", async () => {
    render(<CourseManageView courseId={1} />);
    await waitFor(() => expect(screen.getByRole("heading", { name: "数据结构" })).toBeTruthy());
    expect(mocks.listCourseMembers).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("tab", { name: "成员" }));

    await waitFor(() => expect(mocks.listCourseMembers).toHaveBeenCalled());
    expect(await screen.findByText("student01")).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "角色" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /移出/ })).toBeTruthy();
  });

  it("标签 Tab 展示聚合标签并给新建标签入口", async () => {
    render(<CourseManageView courseId={1} />);
    await waitFor(() => expect(screen.getByRole("heading", { name: "数据结构" })).toBeTruthy());

    fireEvent.click(screen.getByRole("tab", { name: "标签" }));

    expect(screen.getByText("红黑树")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "新建标签" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "确认" })).toBeTruthy();
  });

  it("设置 Tab 为课程状态开关（后端无 status 字段 → 禁用占位）", async () => {
    render(<CourseManageView courseId={1} />);
    await waitFor(() => expect(screen.getByRole("heading", { name: "数据结构" })).toBeTruthy());

    fireEvent.click(screen.getByRole("tab", { name: "设置" }));

    expect(screen.getByText("课程状态")).toBeTruthy();
    expect((screen.getByLabelText("进行中") as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByLabelText("已结课") as HTMLInputElement).disabled).toBe(true);
  });

  it("编辑课程：弹窗预填并提交 PATCH（不含编码）", async () => {
    render(<CourseManageView courseId={1} />);
    await waitFor(() => expect(screen.getByRole("heading", { name: "数据结构" })).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: "编辑课程" }));
    const nameInput = (await screen.findByLabelText("课程名")) as HTMLInputElement;
    expect(nameInput.value).toBe("数据结构");
    // 编码锁定只读（后端 PATCH 不接受 code）
    expect((screen.getByLabelText("课程编码") as HTMLInputElement).disabled).toBe(true);

    fireEvent.change(nameInput, { target: { value: "数据结构（改）" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() =>
      expect(mocks.updateCourse).toHaveBeenCalledWith(
        1,
        expect.objectContaining({ name: "数据结构（改）" }),
      ),
    );
  });

  it("非负责教师看到无权限提示，且不发任何业务请求", async () => {
    mocks.fetchCourseDetail.mockResolvedValue({ ...DETAIL, is_owner: false, can_post: false });
    render(<CourseManageView courseId={1} />);

    await waitFor(() => expect(screen.getByText("你当前的角色没有访问权限")).toBeTruthy());
    expect(screen.queryByRole("tab", { name: "成员" })).toBeNull();
    expect(mocks.listCourseQuestions).not.toHaveBeenCalled();
    expect(mocks.listCourseMembers).not.toHaveBeenCalled();
  });

  it("管理员可以管理非本人课程", async () => {
    mocks.role = "admin";
    mocks.fetchCourseDetail.mockResolvedValue({ ...DETAIL, is_owner: false });
    render(<CourseManageView courseId={1} />);

    await waitFor(() => expect(screen.getByRole("heading", { name: "数据结构" })).toBeTruthy());
    expect(screen.getByRole("tab", { name: "设置" })).toBeTruthy();
  });
});
