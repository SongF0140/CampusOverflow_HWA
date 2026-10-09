import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  getUserReputation: vi.fn(),
  replace: vi.fn(),
  fetchUserQuestions: vi.fn(),
  fetchUserAnswers: vi.fn(),
}));

vi.mock("@/api/users", () => ({
  getUser: mocks.getUser,
  getUserReputation: mocks.getUserReputation,
  fetchUserQuestions: mocks.fetchUserQuestions,
  fetchUserAnswers: mocks.fetchUserAnswers,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: mocks.replace, back: vi.fn(), prefetch: vi.fn() }),
}));

import { ApiError } from "@/api/client";
import type { UserPublic } from "@/shared/types/auth";
import type { PublicReputation } from "@/shared/types/reputation";

import { UserProfileView } from "./UserProfileView";

// email 为泄漏哨兵：公开接口无邮箱字段，若头卡误渲染联系方式该断言立即失败
const USER = {
  id: 7,
  username: "alice",
  role: "student",
  status: "active",
  reputation_score: 1240,
  bio: "数据结构课程助教",
  avatar_url: null,
  created_at: "2026-09-03T10:00:00+08:00",
  email: "alice@example.com",
} as unknown as UserPublic;

const REPUTATION: PublicReputation = {
  user_id: 7,
  username: "alice",
  reputation_score: 1240,
  question_count: 12,
  answer_count: 34,
};

function renderView(initialTab: "questions" | "answers" | "hot" = "questions") {
  return render(<UserProfileView userId={7} initialTab={initialTab} />);
}

describe("UserProfileView", () => {
  beforeEach(() => {
    mocks.getUser.mockResolvedValue(USER);
    mocks.getUserReputation.mockResolvedValue(REPUTATION);
    mocks.fetchUserQuestions.mockResolvedValue({ items: [], total: 0 });
    mocks.fetchUserAnswers.mockResolvedValue({ items: [], total: 0 });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("头卡渲染公开信息：昵称/角色/加入时间/声望摘要，且不含邮箱", async () => {
    renderView();

    expect(await screen.findByText("alice")).toBeTruthy();
    expect(screen.getByText("学生")).toBeTruthy();
    expect(screen.getByText("加入于 2026-09")).toBeTruthy();
    expect(screen.getByText("当前声望")).toBeTruthy();
    expect(screen.getByText("1240")).toBeTruthy();
    expect(screen.getByText("提问 12 · 回答 34")).toBeTruthy();
    // 公开主页绝不出现邮箱/手机号
    expect(screen.queryByText("alice@example.com")).toBeNull();
  });

  it("Tab 切换写 URL：answers/hot 带 tab 参数，默认 questions 不写入", async () => {
    const { rerender } = renderView();

    // rerender 模拟 server 壳解析新 URL 后回传的 initialTab（prop 驱动页签）
    fireEvent.click(await screen.findByRole("tab", { name: "TA 的回答" }));
    expect(mocks.replace).toHaveBeenCalledWith("/users/7?tab=answers");
    rerender(<UserProfileView userId={7} initialTab="answers" />);

    fireEvent.click(screen.getByRole("tab", { name: "热门" }));
    expect(mocks.replace).toHaveBeenCalledWith("/users/7?tab=hot");
    rerender(<UserProfileView userId={7} initialTab="hot" />);

    fireEvent.click(screen.getByRole("tab", { name: "TA 的提问" }));
    expect(mocks.replace).toHaveBeenCalledWith("/users/7");

    // 共 3 次写 URL：挂载期间（未点击前）不写任何 tab 参数
    expect(mocks.replace).toHaveBeenCalledTimes(3);
  });

  it("Tab 内容随页签切换（?tab= 深链经 initialTab 回填）", async () => {
    const { rerender } = renderView("answers");

    expect(await screen.findByText("还没有回答")).toBeTruthy();
    rerender(<UserProfileView userId={7} initialTab="hot" />);
    expect(screen.getByText("热门内容即将开放")).toBeTruthy();
  });

  it("翻页后切换页签或用户，从第一页读取内容", async () => {
    mocks.fetchUserAnswers.mockImplementation(async (_id, page) => ({
      items: [{ id: page, question_id: 3, question_title: `问题${page}`, body: "摘要", vote_score: 1 }],
      total: 11,
    }));
    const { rerender } = renderView("answers");
    await screen.findByRole("link", { name: "问题1" });
    fireEvent.click(screen.getByRole("button", { name: "下一页" }));
    await screen.findByRole("link", { name: "问题2" });
    expect(mocks.fetchUserAnswers).toHaveBeenLastCalledWith(7, 2);
    rerender(<UserProfileView userId={7} initialTab="questions" />);
    await waitFor(() => expect(mocks.fetchUserQuestions).toHaveBeenLastCalledWith(7, 1));
    rerender(<UserProfileView userId={8} initialTab="answers" />);
    await waitFor(() => expect(mocks.fetchUserAnswers).toHaveBeenLastCalledWith(8, 1));
  });

  it("加载失败：错误态展示后端原因并可重试", async () => {
    mocks.getUser.mockRejectedValue(new ApiError(500, "服务暂时不可用"));
    renderView();

    expect(await screen.findByText("加载失败")).toBeTruthy();
    expect(screen.getByText("服务暂时不可用")).toBeTruthy();

    mocks.getUser.mockResolvedValue(USER);
    fireEvent.click(screen.getByRole("button", { name: "重新加载" }));

    expect(await screen.findByText("alice")).toBeTruthy();
    expect(mocks.getUser).toHaveBeenCalledTimes(2);
  });

  it("用户不存在（404）：展示后端中文原因，不渲染头卡", async () => {
    mocks.getUser.mockRejectedValue(new ApiError(404, "用户不存在"));
    renderView();

    expect(await screen.findByText("用户不存在")).toBeTruthy();
    expect(screen.queryByRole("tablist")).toBeNull();
  });
});
