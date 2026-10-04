import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fetchPublicUser: vi.fn(),
  fetchPublicReputation: vi.fn(),
}));

vi.mock("@/api/users", () => ({
  fetchPublicUser: mocks.fetchPublicUser,
  fetchPublicReputation: mocks.fetchPublicReputation,
}));

import { PublicProfileView } from "./PublicProfileView";

beforeEach(() => {
  mocks.fetchPublicUser.mockReset().mockResolvedValue({
    id: 2,
    username: "student01",
    role: "student",
    status: "active",
    reputation_score: 15,
    bio: "喜欢数据结构",
    avatar_url: null,
    created_at: "2026-10-04T14:24:05",
  });
  mocks.fetchPublicReputation.mockReset().mockResolvedValue({
    user_id: 2,
    username: "student01",
    reputation_score: 15,
    question_count: 3,
    answer_count: 1,
  });
});

afterEach(cleanup);

describe("PublicProfileView", () => {
  it("渲染用户名、角色、声誉与提问/回答数", async () => {
    render(<PublicProfileView userId={2} />);

    await waitFor(() => expect(screen.getByRole("heading", { name: "student01" })).toBeTruthy());
    expect(screen.getByText("学生")).toBeTruthy();
    expect(screen.getByText("15")).toBeTruthy();
    expect(screen.getByText("3")).toBeTruthy(); // 提问数
    expect(screen.getByText("1")).toBeTruthy(); // 回答数
    expect(screen.getByText("喜欢数据结构")).toBeTruthy();
  });

  it("不展示邮箱等隐私字段（公开接口本身不返回）", async () => {
    render(<PublicProfileView userId={2} />);
    await waitFor(() => expect(screen.getByRole("heading", { name: "student01" })).toBeTruthy());

    expect(screen.queryByText(/@example\.com/)).toBeNull();
    expect(screen.queryByText(/邮箱/)).toBeNull();
  });
});
