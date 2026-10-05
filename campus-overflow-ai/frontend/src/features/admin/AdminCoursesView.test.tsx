import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listCourses: vi.fn(),
  updateCourse: vi.fn(),
}));

vi.mock("@/api/courses", () => ({
  listCourses: mocks.listCourses,
  updateCourse: mocks.updateCourse,
}));

import type { Course } from "@/shared/types/course";

import { AdminCoursesView } from "./AdminCoursesView";

function buildCourse(overrides: Partial<Course>): Course {
  return {
    id: 1,
    name: "数据库系统",
    code: "CS201",
    teacher_name: "王老师",
    member_count: 32,
    question_count: 18,
    created_at: "2026-09-01T10:00:00+08:00",
    ...overrides,
  };
}

const COURSES: Course[] = [
  buildCourse({ id: 7, name: "数据库系统", code: "CS201", question_count: 18 }),
  buildCourse({
    id: 8,
    name: "操作系统",
    code: "CS301",
    teacher_name: "李老师",
    question_count: 5,
  }),
];

const PAGE_PAYLOAD = { items: COURSES, total: COURSES.length, page: 1, page_size: 10 };

describe("AdminCoursesView", () => {
  beforeEach(() => {
    mocks.listCourses.mockResolvedValue(PAGE_PAYLOAD);
    mocks.updateCourse.mockResolvedValue({ ...COURSES[0] });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("课程表渲染：名称链接指向公开课程页，学期/状态列为“—”占位", async () => {
    render(<AdminCoursesView />);

    expect(await screen.findByText("数据库系统")).toBeTruthy();
    expect(mocks.listCourses).toHaveBeenCalledWith({ page: 1, page_size: 10 });

    const table = screen.getByRole("table");
    const nameLink = within(table).getByRole("link", { name: "数据库系统" });
    expect(nameLink.getAttribute("href")).toBe("/courses/7");
    expect(within(table).getByText("CS201")).toBeTruthy();
    expect(within(table).getByText("王老师")).toBeTruthy();
    expect(table.textContent).toContain("18");
    // 契约差异：列表条目无 semester/status 字段 → 每行各一个“—”占位
    expect(within(table).getAllByText("—").length).toBe(4);
    expect(within(table).getAllByRole("button", { name: "编辑" }).length).toBe(2);
  });

  it("搜索与学期筛选触发服务端请求参数，条件变更回到第 1 页", async () => {
    render(<AdminCoursesView />);
    await screen.findByText("数据库系统");

    // 按钮触发搜索
    fireEvent.change(screen.getByLabelText("搜索课程"), { target: { value: "数据库" } });
    fireEvent.click(screen.getByRole("button", { name: "搜索" }));
    await waitFor(() => {
      expect(mocks.listCourses).toHaveBeenCalledWith({
        page: 1,
        page_size: 10,
        keyword: "数据库",
      });
    });

    // 学期筛选（服务端参数）
    fireEvent.change(screen.getByLabelText("学期"), { target: { value: "2026秋" } });
    await waitFor(() => {
      expect(mocks.listCourses).toHaveBeenCalledWith({
        page: 1,
        page_size: 10,
        keyword: "数据库",
        semester: "2026秋",
      });
    });

    // 回车同样触发搜索
    fireEvent.change(screen.getByLabelText("搜索课程"), { target: { value: "操作系统" } });
    fireEvent.keyDown(screen.getByLabelText("搜索课程"), { key: "Enter" });
    await waitFor(() => {
      expect(mocks.listCourses).toHaveBeenCalledWith({
        page: 1,
        page_size: 10,
        keyword: "操作系统",
        semester: "2026秋",
      });
    });

    // 学期选回“全部”时不再携带 semester 参数
    fireEvent.change(screen.getByLabelText("学期"), { target: { value: "all" } });
    await waitFor(() => {
      expect(mocks.listCourses).toHaveBeenCalledWith({
        page: 1,
        page_size: 10,
        keyword: "操作系统",
      });
    });
  });

  it("编辑 Modal：预填名称/简介为空、编码锁定，PATCH 载荷不含 code 与 description", async () => {
    render(<AdminCoursesView />);
    await screen.findByText("数据库系统");

    fireEvent.click(within(screen.getByRole("table")).getAllByRole("button", { name: "编辑" })[0]);
    expect(screen.getByRole("dialog")).toBeTruthy();

    const nameInput = screen.getByLabelText("课程名") as HTMLInputElement;
    expect(nameInput.value).toBe("数据库系统");
    const codeInput = screen.getByLabelText("课程编码") as HTMLInputElement;
    expect(codeInput.value).toBe("CS201");
    // 契约差异：列表条目无 description 字段 → 预填空字符串
    const descriptionInput = screen.getByLabelText("课程简介") as HTMLTextAreaElement;
    expect(descriptionInput.value).toBe("");
    // 后端 CourseUpdateRequest 不收 code → lockCode 置灰
    expect(codeInput.disabled).toBe(true);

    fireEvent.change(nameInput, { target: { value: "数据库系统进阶" } });
    // 页面筛选与 Modal 内均有“学期”label → 以 dialog 范围定位表单内下拉
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("学期"), { target: { value: "2026秋" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "保存" }));

    await waitFor(() => {
      expect(mocks.updateCourse).toHaveBeenCalledWith(7, {
        name: "数据库系统进阶",
        semester: "2026秋",
      });
    });
    const payload = mocks.updateCourse.mock.calls[0][1] as Record<string, unknown>;
    expect(Object.keys(payload)).not.toContain("code");
    expect(Object.keys(payload)).not.toContain("description");
  });

  it("未改动学期时 PATCH 仅提交 name（避免清空列表接口未返回的学期/简介）", async () => {
    render(<AdminCoursesView />);
    await screen.findByText("数据库系统");

    fireEvent.click(within(screen.getByRole("table")).getAllByRole("button", { name: "编辑" })[0]);
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => {
      expect(mocks.updateCourse).toHaveBeenCalledWith(7, { name: "数据库系统" });
    });
  });

  it("保存成功：Toast“课程已更新”并刷新列表", async () => {
    render(<AdminCoursesView />);
    await screen.findByText("数据库系统");

    fireEvent.click(within(screen.getByRole("table")).getAllByRole("button", { name: "编辑" })[0]);
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    expect(await screen.findByText("课程已更新")).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
    await waitFor(() => {
      expect(mocks.listCourses.mock.calls.length).toBeGreaterThanOrEqual(2);
    });
  });

  it("保存失败：Modal 保留并行内提示错误", async () => {
    mocks.updateCourse.mockRejectedValue(new Error("没有编辑权限"));
    render(<AdminCoursesView />);
    await screen.findByText("数据库系统");

    fireEvent.click(within(screen.getByRole("table")).getAllByRole("button", { name: "编辑" })[0]);
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    expect(await screen.findByText("没有编辑权限")).toBeTruthy();
    expect(screen.getByRole("dialog")).not.toBeNull();
  });

  it("加载/错误/空三态：骨架屏、错误重试与空态", async () => {
    // 加载态：骨架屏（无整页转圈）
    mocks.listCourses.mockReturnValue(new Promise(() => {}));
    const first = render(<AdminCoursesView />);
    expect(await screen.findByText("正在加载内容")).toBeTruthy();
    first.unmount();

    // 错误态：中文提示 + 重试
    mocks.listCourses.mockRejectedValue(new Error("服务暂时不可用"));
    const second = render(<AdminCoursesView />);
    expect(await screen.findByText("服务暂时不可用")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "重新加载" }));
    await waitFor(() => {
      expect(mocks.listCourses.mock.calls.length).toBeGreaterThanOrEqual(2);
    });
    second.unmount();

    // 空态
    mocks.listCourses.mockResolvedValue({ items: [], total: 0, page: 1, page_size: 10 });
    render(<AdminCoursesView />);
    expect(await screen.findByText("暂无课程")).toBeTruthy();
  });
});
