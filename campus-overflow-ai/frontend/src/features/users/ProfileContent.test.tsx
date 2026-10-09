import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ fetchUserAnswers: vi.fn(), fetchUserQuestions: vi.fn() }));
vi.mock("@/api/users", () => mocks);
import { ProfileContent } from "./ProfileContent";
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("公开内容分页", () => {
  it("用户回答下一页来自服务端，链接带回答锚点", async () => {
    mocks.fetchUserAnswers.mockImplementation(async (_id, page) => ({
      items: [{ id: page, question_id: 3, question_title: `问题${page}`, body: "回答摘要", vote_score: 8 }], total: 11,
    }));
    render(<ProfileContent userId={7} tab="answers" />);
    expect((await screen.findByRole("link", { name: "问题1" })).getAttribute("href")).toBe("/questions/3#answer-1");
    fireEvent.click(screen.getByRole("button", { name: "下一页" }));
    await screen.findByText("问题2");
    expect(mocks.fetchUserAnswers).toHaveBeenLastCalledWith(7, 2);
  });

  it("问题卡使用真实课程名，不额外扫描课程", async () => {
    mocks.fetchUserQuestions.mockResolvedValue({ items: [{ id: 4, title: "我的提问", course_id: 99, course_name: "真实课程", author: "alice", tags: [], created_at: "2026-10-09" }], total: 1 });
    render(<ProfileContent userId={7} tab="questions" />);
    expect(await screen.findByText("真实课程")).toBeTruthy();
    expect(mocks.fetchUserQuestions).toHaveBeenCalledWith(7, 1);
  });

  it("加载、错误重试与空态", async () => {
    mocks.fetchUserQuestions.mockRejectedValueOnce(new Error("读取失败")).mockResolvedValue({ items: [], total: 0 });
    render(<ProfileContent userId={7} tab="questions" />);
    expect(screen.getByText("正在加载内容")).toBeTruthy();
    await screen.findByText("读取失败");
    fireEvent.click(screen.getByRole("button", { name: "重新加载" }));
    await waitFor(() => expect(screen.getByText("还没有提问")).toBeTruthy());
  });
});
