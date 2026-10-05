import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ fetchCourses: vi.fn() }));

vi.mock("@/api/courses", () => ({ fetchCourses: mocks.fetchCourses }));

import { CourseList } from "./CourseList";

const LIST = {
  items: [
    {
      id: 1,
      name: "数据结构",
      code: "CS101",
      teacher_name: "teacher01",
      member_count: 12,
      question_count: 3,
      created_at: "2026-09-01T00:00:00+08:00",
    },
    {
      id: 2,
      name: "操作系统",
      code: "CS102",
      teacher_name: "teacher02",
      member_count: 8,
      question_count: 0,
      created_at: "2026-09-01T00:00:00+08:00",
    },
  ],
  total: 2,
  page: 1,
  page_size: 20,
};

beforeEach(() => {
  mocks.fetchCourses.mockReset().mockResolvedValue(LIST);
});

afterEach(cleanup);

describe("CourseList", () => {
  it("渲染课程卡（课程名 / 编码 / 教师 / 成员与问题数）", async () => {
    render(<CourseList />);

    await waitFor(() => expect(screen.getByText("数据结构")).toBeTruthy());
    expect(screen.getByRole("link", { name: "数据结构" }).getAttribute("href")).toBe("/courses/1");
    expect(screen.getByText("CS101")).toBeTruthy();
    expect(screen.getByText("授课：teacher01")).toBeTruthy();
    expect(screen.getByText("12 成员")).toBeTruthy();
    expect(screen.getByText("3 问题")).toBeTruthy();
    expect(screen.getByText("共 2 门课程")).toBeTruthy();
  });

  it("无匹配时展示空状态，清除筛选后恢复列表", async () => {
    mocks.fetchCourses.mockImplementation((params: { keyword?: string }) =>
      Promise.resolve(params.keyword ? { items: [], total: 0, page: 1, page_size: 20 } : LIST),
    );
    render(<CourseList initialKeyword="不存在的课程" />);

    await waitFor(() => expect(screen.getByText("没有找到符合条件的课程")).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: "清除筛选" }));

    await waitFor(() => expect(screen.getByText("数据结构")).toBeTruthy());
  });

  it("搜索会把关键词传给接口并重置页码", async () => {
    render(<CourseList />);
    await waitFor(() => expect(screen.getByText("数据结构")).toBeTruthy());

    fireEvent.change(screen.getByLabelText("搜索课程名或编码"), { target: { value: "CS101" } });

    await waitFor(() =>
      expect(mocks.fetchCourses).toHaveBeenCalledWith(
        expect.objectContaining({ keyword: "CS101", page: 1 }),
      ),
    );
  });

  it("分页：共 25 门时显示两页并可翻到第 2 页", async () => {
    mocks.fetchCourses.mockResolvedValue({ ...LIST, total: 25 });
    render(<CourseList />);

    await waitFor(() => expect(screen.getByText("第 1 / 2 页")).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: "下一页" }));

    await waitFor(() =>
      expect(mocks.fetchCourses).toHaveBeenCalledWith(expect.objectContaining({ page: 2 })),
    );
    expect(screen.getByText("第 2 / 2 页")).toBeTruthy();
  });
});
