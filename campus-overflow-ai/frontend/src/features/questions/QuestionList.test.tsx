import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { QuestionListItem } from "@/shared/types/question";

const mocks = vi.hoisted(() => ({
  fetchQuestionList: vi.fn(),
  fetchCourseNameMap: vi.fn(),
}));

// 广场数据源已切真接口（@/api/questions）；课程名走课程映射（后端暂无 course_name）
vi.mock("@/api/questions", () => ({ fetchQuestionList: mocks.fetchQuestionList }));
vi.mock("@/api/courses", () => ({ fetchCourseNameMap: mocks.fetchCourseNameMap }));

import { QuestionList } from "./QuestionList";

const makeQuestion = (
  id: number,
  title: string,
  status: QuestionListItem["status"] = "published",
): QuestionListItem => ({
  id,
  title,
  course_id: 1,
  author: "student01",
  tags: [{ id: 1, name: "红黑树", type: "tech" }],
  status,
  vote_score: 3,
  my_vote: 0,
  answer_count: 1,
  view_count: 10,
  has_accepted: status === "resolved",
  created_at: "2026-10-04T09:00:00+08:00",
});

const LIST = {
  items: [makeQuestion(101, "红黑树的删除操作为什么要分四种情况"), makeQuestion(102, "进程和线程的区别")],
  total: 2,
  page: 1,
  page_size: 20,
};

beforeEach(() => {
  mocks.fetchQuestionList.mockReset().mockResolvedValue(LIST);
  mocks.fetchCourseNameMap.mockReset().mockResolvedValue({ 1: "数据结构" });
});

afterEach(cleanup);

describe("QuestionList", () => {
  it("加载真接口数据并渲染卡片（课程名来自课程映射）", async () => {
    render(<QuestionList />);

    expect(screen.getByRole("heading", { name: "问题广场" })).toBeTruthy();
    await waitFor(() => expect(screen.getByText(/红黑树的删除操作/)).toBeTruthy());

    // 两张卡片都指向同一门课，课程名应都来自课程映射
    expect((await screen.findAllByText("数据结构")).length).toBe(2);
    expect(screen.getByText("共 2 条")).toBeTruthy();
    expect(mocks.fetchQuestionList).toHaveBeenCalledWith(
      expect.objectContaining({ page: 1, page_size: 20, sort: "latest" }),
    );
  });

  it("关键词无匹配时展示空状态，清除筛选后恢复列表", async () => {
    mocks.fetchQuestionList.mockImplementation(
      (params: { keyword?: string }) =>
        Promise.resolve(params.keyword ? { items: [], total: 0, page: 1, page_size: 20 } : LIST),
    );
    render(<QuestionList initialKeyword="绝对不存在的关键词" />);

    await waitFor(() => expect(screen.getByText("没有找到符合条件的问题")).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: "清除筛选" }));

    await waitFor(() => expect(screen.getByText(/红黑树的删除操作/)).toBeTruthy());
  });

  it("只看未解决会把筛选条件传给接口", async () => {
    render(<QuestionList />);
    await waitFor(() => expect(screen.getByText(/红黑树的删除操作/)).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: "只看未解决" }));

    await waitFor(() =>
      expect(mocks.fetchQuestionList).toHaveBeenCalledWith(
        expect.objectContaining({ unresolved: true, page: 1 }),
      ),
    );
  });

  it("分页：每页 20 条，可翻到第 2 页", async () => {
    mocks.fetchQuestionList.mockResolvedValue({ ...LIST, total: 25 });
    render(<QuestionList />);

    await waitFor(() => expect(screen.getByText("第 1 / 2 页")).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: "下一页" }));

    await waitFor(() =>
      expect(mocks.fetchQuestionList).toHaveBeenCalledWith(expect.objectContaining({ page: 2 })),
    );
    expect(screen.getByText("第 2 / 2 页")).toBeTruthy();
  });
});
