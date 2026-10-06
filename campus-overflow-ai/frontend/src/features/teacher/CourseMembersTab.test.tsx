import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ fetchCourseMembers: vi.fn() }));

vi.mock("@/api/courses", () => ({ fetchCourseMembers: mocks.fetchCourseMembers }));

import { CourseMembersTab } from "./CourseMembersTab";

const MEMBER = { user_id: 11, username: "student01", joined_at: "2026-10-04T14:24:05+08:00" };

beforeEach(() => {
  mocks.fetchCourseMembers.mockReset().mockResolvedValue({
    items: [MEMBER],
    total: 1,
    page: 1,
    page_size: 20,
  });
});

afterEach(cleanup);

describe("CourseMembersTab", () => {
  it("渲染成员并链到用户主页", async () => {
    render(<CourseMembersTab courseId={1} />);

    await waitFor(() => expect(screen.getByText("student01")).toBeTruthy());
    expect(screen.getByRole("link", { name: "student01" }).getAttribute("href")).toBe("/users/11");
    expect(screen.getByText("共 1 名成员")).toBeTruthy();
    expect(mocks.fetchCourseMembers).toHaveBeenCalledWith(1, { page: 1, page_size: 20 });
  });

  it("成员超过一页时可翻页", async () => {
    mocks.fetchCourseMembers.mockImplementation((_id: number, params: { page?: number }) =>
      Promise.resolve({ items: [MEMBER], total: 25, page: params.page ?? 1, page_size: 20 }),
    );
    render(<CourseMembersTab courseId={1} />);

    await waitFor(() => expect(screen.getByText("第 1 / 2 页")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "下一页" }));

    await waitFor(() =>
      expect(mocks.fetchCourseMembers).toHaveBeenCalledWith(1, { page: 2, page_size: 20 }),
    );
    expect(screen.getByText("第 2 / 2 页")).toBeTruthy();
  });

  it("没有成员时给出空态", async () => {
    mocks.fetchCourseMembers.mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      page_size: 20,
    });
    render(<CourseMembersTab courseId={1} />);

    await waitFor(() => expect(screen.getByText("还没有成员加入")).toBeTruthy());
  });

  it("接口失败时给出错误态与重试", async () => {
    mocks.fetchCourseMembers.mockRejectedValue(new Error("network down"));
    render(<CourseMembersTab courseId={1} />);

    await waitFor(() => expect(screen.getByText(/成员列表加载失败/)).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "重新加载" }));
    await waitFor(() => expect(mocks.fetchCourseMembers.mock.calls.length).toBeGreaterThan(1));
  });
});
