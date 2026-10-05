import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listCourses: vi.fn(),
  createCourse: vi.fn(),
}));

vi.mock("@/api/courses", () => ({
  listCourses: mocks.listCourses,
  createCourse: mocks.createCourse,
}));

import type { Paged } from "@/shared/types/common";
import type { Course, CourseRecord } from "@/shared/types/course";

import { TeacherCoursesView } from "./TeacherCoursesView";

const COURSES: Course[] = [
  {
    id: 1,
    name: "计算机网络",
    code: "CS301",
    teacher_name: "王老师",
    member_count: 32,
    question_count: 12,
    created_at: "2026-09-01T10:00:00+08:00",
  },
  {
    id: 2,
    name: "操作系统",
    code: "CS201",
    teacher_name: "李老师",
    member_count: 45,
    question_count: 8,
    created_at: "2026-09-02T10:00:00+08:00",
  },
];

const EMPTY_PAGE: Paged<Course> = { items: [], total: 0, page: 1, page_size: 100 };

const CREATED_RECORD: CourseRecord = {
  id: 3,
  name: "数据库系统",
  code: "CS401",
  description: null,
  semester: null,
  teacher_id: 7,
  created_at: "2026-10-06T10:00:00+08:00",
  updated_at: "2026-10-06T10:00:00+08:00",
};

function fillAndSubmit(name: string, code: string): void {
  fireEvent.click(screen.getByRole("button", { name: /新建课程/ }));
  fireEvent.change(screen.getByLabelText("课程名"), { target: { value: name } });
  fireEvent.change(screen.getByLabelText("课程编码"), { target: { value: code } });
  fireEvent.click(screen.getByRole("button", { name: "保存" }));
}

describe("TeacherCoursesView", () => {
  beforeEach(() => {
    mocks.listCourses.mockResolvedValue({ items: COURSES, total: 2, page: 1, page_size: 100 });
    mocks.createCourse.mockResolvedValue(CREATED_RECORD);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("加载中渲染骨架屏", () => {
    mocks.listCourses.mockReturnValue(new Promise(() => undefined));
    render(<TeacherCoursesView />);

    expect(screen.getByText("正在加载内容")).toBeTruthy();
  });

  it("渲染课程卡：名称/编码/教师/成员数/问题数 + [管理] 链接指向管理详情", async () => {
    render(<TeacherCoursesView />);

    expect(await screen.findByText("计算机网络")).toBeTruthy();
    expect(screen.getByText("操作系统")).toBeTruthy();
    expect(screen.getByText("CS301")).toBeTruthy();
    expect(screen.getByText(/王老师/)).toBeTruthy();
    expect(screen.getByText(/32 名成员/)).toBeTruthy();
    expect(screen.getByText(/12 个问题/)).toBeTruthy();

    const manageLinks = screen.getAllByRole("link", { name: "管理" }) as HTMLAnchorElement[];
    expect(manageLinks).toHaveLength(2);
    expect(manageLinks[0].getAttribute("href")).toBe("/teacher/courses/1");
    expect(manageLinks[1].getAttribute("href")).toBe("/teacher/courses/2");
    expect(mocks.listCourses).toHaveBeenCalledWith({ page: 1, page_size: 100 });
  });

  it("无课程渲染空态引导新建", async () => {
    mocks.listCourses.mockResolvedValue(EMPTY_PAGE);
    render(<TeacherCoursesView />);

    expect(await screen.findByText("还没有课程")).toBeTruthy();
    expect(screen.getByText(/点击右上角新建/)).toBeTruthy();
  });

  it("加载失败渲染错误态，重试重新拉取列表", async () => {
    mocks.listCourses.mockRejectedValue(new Error("服务暂时不可用，请稍后重试"));
    render(<TeacherCoursesView />);

    expect(await screen.findByText("加载失败")).toBeTruthy();
    expect(screen.getByText("服务暂时不可用，请稍后重试")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "重新加载" }));
    await waitFor(() => {
      expect(mocks.listCourses).toHaveBeenCalledTimes(2);
    });
  });

  it("新建课程：Modal 打开→提交→createCourse 载荷→成功 Toast→列表刷新→Modal 关闭", async () => {
    render(<TeacherCoursesView />);
    await screen.findByText("计算机网络");

    fillAndSubmit("数据库系统", "CS401");

    await waitFor(() => {
      expect(mocks.createCourse).toHaveBeenCalledWith({
        name: "数据库系统",
        code: "CS401",
        description: null,
        semester: null,
      });
    });
    // 成功 Toast（role=status）与刷新（reloadToken 变化重拉）
    expect(await screen.findByText("课程已创建")).toBeTruthy();
    const toast = screen.getByRole("status");
    expect(toast.textContent).toContain("课程已创建");
    await waitFor(() => {
      expect(mocks.listCourses).toHaveBeenCalledTimes(2);
    });
    expect(screen.queryByLabelText("课程名")).toBeNull();
  });

  it("新建失败：submitError 行内展示，Modal 保留已填内容且不出 Toast", async () => {
    render(<TeacherCoursesView />);
    await screen.findByText("计算机网络");

    mocks.createCourse.mockRejectedValue(new Error("课程编码已存在"));
    fillAndSubmit("数据库系统", "CS401");

    expect(await screen.findByText("课程编码已存在")).toBeTruthy();
    expect((screen.getByLabelText("课程名") as HTMLInputElement).value).toBe("数据库系统");
    expect(screen.queryByText("课程已创建")).toBeNull();
    expect(mocks.listCourses).toHaveBeenCalledTimes(1);
  });
});
