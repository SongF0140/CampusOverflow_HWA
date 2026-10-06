import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/",
}));
vi.mock("@/shared/stores/session-store", () => ({
  useSessionStore: (selector: (state: unknown) => unknown) =>
    selector({ user: { username: "student01" }, load: vi.fn(), signOut: vi.fn() }),
}));
vi.mock("@/shared/stores/notification-store", () => ({
  useNotificationStore: (selector: (state: unknown) => unknown) =>
    selector({ unreadCount: 5, load: vi.fn() }),
}));

import { TopNav } from "./TopNav";

afterEach(cleanup);

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
});
