import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push, replace: mocks.replace }),
  usePathname: () => "/",
}));
vi.mock("@/shared/stores/session-store", () => ({
  useSessionStore: (selector: (state: unknown) => unknown) =>
    selector({
      me: { username: "student01" },
      status: "authed",
      loadMe: vi.fn(),
      logout: vi.fn(),
    }),
}));
vi.mock("@/shared/stores/notification-store", () => ({
  useNotificationStore: (selector: (state: unknown) => unknown) =>
    selector({ unreadCount: 5, load: vi.fn() }),
}));

import { TopNav } from "./TopNav";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("TopNav", () => {
  it("宽屏主导航：课程 / 榜单 / 通知（带未读徽标）/ 提问 / 用户名进个人中心", () => {
    render(<TopNav />);
    const nav = screen.getByRole("navigation", { name: "主导航" });

    expect(within(nav).getByRole("link", { name: "课程" }).getAttribute("href")).toBe("/courses");
    expect(within(nav).getByRole("link", { name: "榜单" }).getAttribute("href")).toBe("/rankings");
    expect(within(nav).getByRole("link", { name: /通知/ }).getAttribute("href")).toBe(
      "/notifications",
    );
    expect(within(nav).getByText("5")).toBeTruthy();
    expect(within(nav).getByRole("link", { name: "＋ 提问" }).getAttribute("href")).toBe(
      "/questions/new",
    );
    expect(within(nav).getByRole("link", { name: "student01" }).getAttribute("href")).toBe("/me");
  });

  it("窄屏抽屉：课程 / 榜单 / 通知 / 个人中心同样可达（主导航折叠不丢入口）", () => {
    render(<TopNav />);
    const drawer = screen.getByRole("navigation", { name: "窄屏主导航" });

    expect(within(drawer).getByRole("link", { name: "课程" }).getAttribute("href")).toBe("/courses");
    expect(within(drawer).getByRole("link", { name: "榜单" }).getAttribute("href")).toBe("/rankings");
    expect(within(drawer).getByRole("link", { name: /通知/ }).getAttribute("href")).toBe(
      "/notifications",
    );
    expect(within(drawer).getByRole("link", { name: /个人中心/ }).getAttribute("href")).toBe("/me");
  });

  // 回归：原来跳到 `/?keyword=`，而广场不处理 keyword（只认 course_id/tag_id/sort/unresolved），
  // 表现为"搜索框敲回车没反应"——搜索要归搜索页
  it("搜索框回车跳搜索页 /search?q=，关键词去除首尾空格", () => {
    render(<TopNav />);
    const input = screen.getAllByLabelText("全站搜索")[0];
    fireEvent.change(input, { target: { value: "  二分  " } });
    fireEvent.submit(input.closest("form") as HTMLFormElement);

    expect(mocks.push).toHaveBeenCalledWith("/search?q=" + encodeURIComponent("二分"));
  });

  it("搜索框为空时回首页", () => {
    render(<TopNav />);
    const input = screen.getAllByLabelText("全站搜索")[0];
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.submit(input.closest("form") as HTMLFormElement);

    expect(mocks.push).toHaveBeenCalledWith("/");
  });
});
