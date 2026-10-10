import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ listTags: vi.fn(), getRank: vi.fn() }));

vi.mock("@/api/tags", () => ({ listTags: mocks.listTags }));
vi.mock("@/api/reputation", () => ({ getRank: mocks.getRank }));

import { RightRail } from "./RightRail";

beforeEach(() => {
  mocks.listTags.mockReset().mockResolvedValue({
    items: [{ id: 1, name: "红黑树", type: "tech", question_count: 3 }],
  });
  mocks.getRank.mockReset().mockResolvedValue({
    items: [{ user_id: 11, username: "student01", score: 320 }],
  });
});

afterEach(cleanup);

describe("RightRail", () => {
  it("周榜热门用户与热门标签正常渲染，并链到榜单页 / 标签页 / 用户主页", async () => {
    render(<RightRail />);

    await waitFor(() => expect(screen.getByText("热门用户")).toBeTruthy());
    expect(mocks.listTags).toHaveBeenCalledWith({ hot: true });
    expect(mocks.getRank).toHaveBeenCalledWith({ period: "week" });
    expect(screen.getByRole("link", { name: "查看完整榜单" }).getAttribute("href")).toBe(
      "/rankings",
    );
    // UserLine 的可访问名含昵称与角色徽标，用模糊匹配
    expect(screen.getByRole("link", { name: /student01/ }).getAttribute("href")).toBe("/users/11");
    expect(screen.getByText("热门标签")).toBeTruthy();
    expect(screen.getByRole("link", { name: "红黑树" }).getAttribute("href")).toBe("/tags/1");
  });

  it("榜单为空时热门用户卡整体隐藏，标签卡不受影响", async () => {
    mocks.getRank.mockResolvedValue({ items: [] });
    render(<RightRail />);

    await waitFor(() => expect(screen.queryByText("热门用户")).toBeNull());
    expect(screen.getByText("热门标签")).toBeTruthy();
  });

  it("接口失败时给出中文兜底提示", async () => {
    mocks.listTags.mockRejectedValue(new Error("network down"));
    render(<RightRail />);

    await waitFor(() => expect(screen.getByText(/边栏内容暂时无法加载/)).toBeTruthy());
  });
});
