import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ fetchRanking: vi.fn(), fetchCourses: vi.fn() }));

vi.mock("@/api/reputation", () => ({ fetchRanking: mocks.fetchRanking }));
vi.mock("@/api/courses", () => ({ fetchCourses: mocks.fetchCourses }));

import { RankingView } from "./RankingView";

beforeEach(() => {
  mocks.fetchRanking.mockReset().mockResolvedValue({
    items: [
      { user_id: 11, username: "student01", score: 320 },
      { user_id: 12, username: "teacher01", score: 285 },
    ],
  });
  mocks.fetchCourses.mockReset().mockResolvedValue({
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
    ],
    total: 1,
    page: 1,
    page_size: 100,
  });
});

afterEach(cleanup);

describe("RankingView", () => {
  it("按顺序渲染名次（后端不返回名次字段）并链到用户主页", async () => {
    render(<RankingView />);

    await waitFor(() => expect(screen.getByText("student01")).toBeTruthy());
    expect(screen.getByText("1")).toBeTruthy();
    expect(screen.getByText("2")).toBeTruthy();
    expect(screen.getByRole("link", { name: "student01" }).getAttribute("href")).toBe("/users/11");
    expect(screen.getByText("320 分")).toBeTruthy();
  });

  it("切换周榜会带 period=week 重新请求", async () => {
    render(<RankingView />);
    await waitFor(() => expect(screen.getByText("student01")).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: "周榜" }));

    await waitFor(() =>
      expect(mocks.fetchRanking).toHaveBeenCalledWith(expect.objectContaining({ period: "week" })),
    );
  });

  it("选择课程后按 course_id 拉课程榜", async () => {
    render(<RankingView />);
    await waitFor(() => expect(screen.getByText("student01")).toBeTruthy());

    fireEvent.change(screen.getByLabelText(/课程榜/), { target: { value: "1" } });

    await waitFor(() =>
      expect(mocks.fetchRanking).toHaveBeenCalledWith(expect.objectContaining({ course_id: 1 })),
    );
  });
});
