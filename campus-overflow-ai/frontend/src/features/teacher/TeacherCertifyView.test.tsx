import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ fetchMyCourses: vi.fn(), fetchQuestionList: vi.fn() }));

vi.mock("@/api/courses", () => ({ fetchMyCourses: mocks.fetchMyCourses }));
vi.mock("@/api/questions", () => ({ fetchQuestionList: mocks.fetchQuestionList }));
vi.mock("@/shared/stores/session-store", () => ({
  useSessionStore: (selector: (state: unknown) => unknown) =>
    selector({ user: { username: "teacher01" }, status: "ready", load: vi.fn() }),
}));

import { TeacherCertifyView } from "./TeacherCertifyView";

const COURSES = [
  {
    id: 1,
    name: "数据结构",
    code: "CS101",
    teacher_name: "teacher01",
    member_count: 1,
    question_count: 4,
    created_at: "",
  },
];

beforeEach(() => {
  mocks.fetchMyCourses.mockReset().mockResolvedValue(COURSES);
  mocks.fetchQuestionList.mockReset().mockResolvedValue({
    items: [],
    total: 0,
    page: 1,
    page_size: 20,
  });
});

afterEach(cleanup);

describe("TeacherCertifyView", () => {
  it("选课程后才拉该课程的问答列表", async () => {
    render(<TeacherCertifyView />);

    await waitFor(() => expect(screen.getByRole("button", { name: /数据结构/ })).toBeTruthy());
    expect(mocks.fetchMyCourses).toHaveBeenCalledWith("teacher01");
    expect(screen.getByText("先选择一门课程，下面会显示它的问答列表。")).toBeTruthy();
    expect(mocks.fetchQuestionList).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /数据结构/ }));

    await waitFor(() =>
      expect(mocks.fetchQuestionList).toHaveBeenCalledWith(
        expect.objectContaining({ course_id: 1, page: 1 }),
      ),
    );
  });

  it("没有负责的课程时给出空态与说明", async () => {
    mocks.fetchMyCourses.mockResolvedValue([]);
    render(<TeacherCertifyView />);

    await waitFor(() => expect(screen.getByText("还没有你负责的课程")).toBeTruthy());
    expect(screen.getByText(/只有你任教课程里的回答才能被你认证/)).toBeTruthy();
  });

  it("接口失败时给出错误态与重试", async () => {
    mocks.fetchMyCourses.mockRejectedValue(new Error("network down"));
    render(<TeacherCertifyView />);

    await waitFor(() => expect(screen.getByText(/课程列表加载失败/)).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "重新加载" }));
    await waitFor(() => expect(mocks.fetchMyCourses.mock.calls.length).toBeGreaterThan(1));
  });
});
