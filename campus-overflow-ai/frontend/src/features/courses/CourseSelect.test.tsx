import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ fetchCourses: vi.fn(), fetchCourseDetail: vi.fn() }));

vi.mock("@/api/courses", () => ({
  fetchCourses: mocks.fetchCourses,
  fetchCourseDetail: mocks.fetchCourseDetail,
}));

import { CourseSelect } from "./CourseSelect";

const COURSE = {
  id: 1,
  name: "数据结构",
  code: "CS101",
  teacher_name: "teacher01",
  member_count: 1,
  question_count: 0,
  created_at: "",
};

beforeEach(() => {
  mocks.fetchCourses.mockReset();
  mocks.fetchCourseDetail.mockReset();
});

afterEach(cleanup);

describe("CourseSelect", () => {
  it("课程不超过一页时不出现搜索框，直接给下拉", async () => {
    mocks.fetchCourses.mockResolvedValue({ items: [COURSE], total: 1, page: 1, page_size: 50 });
    render(<CourseSelect label="课程榜" value={undefined} onChange={vi.fn()} placeholder="全部课程" />);

    await waitFor(() => expect(screen.getByLabelText("课程榜")).toBeTruthy());
    expect(screen.queryByLabelText("搜索课程名或编码")).toBeNull();
    expect(screen.queryByRole("button", { name: /加载更多课程/ })).toBeNull();
  });

  it("课程超过一页（>50）时可按关键词搜索，并逐页加载更多", async () => {
    mocks.fetchCourses.mockImplementation((params: { page?: number; keyword?: string }) =>
      Promise.resolve(
        params.keyword
          ? { items: [COURSE], total: 1, page: 1, page_size: 50 }
          : { items: [COURSE], total: 120, page: params.page ?? 1, page_size: 50 },
      ),
    );
    render(<CourseSelect label="课程榜" value={undefined} onChange={vi.fn()} placeholder="全部课程" />);

    // 第一页只有 1 条，但总数 120 → 必须给「加载更多」，不能把第一页当全量
    const more = await screen.findByRole("button", { name: /加载更多课程（已显示 1 \/ 120）/ });
    expect(screen.getByLabelText("搜索课程名或编码")).toBeTruthy();

    fireEvent.click(more);
    await waitFor(() =>
      expect(mocks.fetchCourses).toHaveBeenCalledWith(expect.objectContaining({ page: 2 })),
    );

    fireEvent.change(screen.getByLabelText("搜索课程名或编码"), { target: { value: "CS101" } });
    await waitFor(() =>
      expect(mocks.fetchCourses).toHaveBeenCalledWith(
        expect.objectContaining({ keyword: "CS101", page: 1 }),
      ),
    );
  });

  it("关键词搜到 0 条时搜索框仍在，清除关键词后恢复列表", async () => {
    mocks.fetchCourses.mockImplementation((params: { keyword?: string }) =>
      Promise.resolve(
        params.keyword
          ? { items: [], total: 0, page: 1, page_size: 50 }
          : { items: [COURSE], total: 120, page: 1, page_size: 50 },
      ),
    );
    render(<CourseSelect label="课程榜" value={undefined} onChange={vi.fn()} placeholder="全部课程" />);

    await screen.findByLabelText("搜索课程名或编码");
    fireEvent.change(screen.getByLabelText("搜索课程名或编码"), { target: { value: "不存在" } });

    await waitFor(() => expect(screen.getByText("没有匹配的课程，换个关键词试试。")).toBeTruthy());
    // 关键：搜索框不能因为结果变少而自己消失，否则用户无法修改或清除关键词
    expect(screen.getByLabelText("搜索课程名或编码")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("搜索课程名或编码"), { target: { value: "" } });
    await waitFor(() => expect(screen.getByRole("option", { name: /数据结构/ })).toBeTruthy());
    expect(screen.queryByText("没有匹配的课程，换个关键词试试。")).toBeNull();
  });

  it("深链接带入的课程不在第一页时，补取详情并出现在选项里", async () => {
    mocks.fetchCourses.mockResolvedValue({ items: [COURSE], total: 120, page: 1, page_size: 50 });
    mocks.fetchCourseDetail.mockResolvedValue({
      id: 75,
      name: "编译原理",
      code: "CS301",
      teacher_name: "teacher09",
    });
    render(<CourseSelect label="课程榜" value={75} onChange={vi.fn()} placeholder="全部课程" />);

    await waitFor(() => expect(mocks.fetchCourseDetail).toHaveBeenCalledWith(75));
    expect(screen.getByRole("option", { name: /编译原理/ })).toBeTruthy();
    expect((screen.getByLabelText("课程榜") as HTMLSelectElement).value).toBe("75");
  });
});
