import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ fetchTags: vi.fn(), fetchRanking: vi.fn() }));

vi.mock("@/api/tags", () => ({ fetchTags: mocks.fetchTags }));
vi.mock("@/api/reputation", () => ({ fetchRanking: mocks.fetchRanking }));

import { RightRail } from "./RightRail";

beforeEach(() => {
  mocks.fetchTags.mockReset().mockResolvedValue({
    items: [{ id: 1, name: "红黑树", type: "tech", question_count: 3 }],
  });
  mocks.fetchRanking.mockReset().mockResolvedValue({
    items: [{ user_id: 11, username: "student01", score: 320 }],
  });
});

afterEach(cleanup);

describe("RightRail", () => {
  it("走真接口，并链到标签页 / 榜单页 / 用户主页", async () => {
    render(<RightRail />);

    await waitFor(() => expect(screen.getByText("红黑树")).toBeTruthy());
    expect(mocks.fetchTags).toHaveBeenCalledWith({ hot: true });
    expect(mocks.fetchRanking).toHaveBeenCalledWith({ period: "all" });
    expect(screen.getByRole("link", { name: "红黑树" }).getAttribute("href")).toBe("/tags/1");
    expect(screen.getByRole("link", { name: /积分榜/ }).getAttribute("href")).toBe("/rankings");
    expect(screen.getByRole("link", { name: "student01" }).getAttribute("href")).toBe("/users/11");
  });

  it("接口失败时给出中文兜底提示", async () => {
    mocks.fetchTags.mockRejectedValue(new Error("network down"));
    render(<RightRail />);

    await waitFor(() => expect(screen.getByText(/边栏内容暂时无法加载/)).toBeTruthy());
  });
});
