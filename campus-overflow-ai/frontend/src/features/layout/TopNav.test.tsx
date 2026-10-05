import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));
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
  it("用户名链到个人中心，通知入口带未读数徽标", () => {
    render(<TopNav />);

    expect(screen.getByRole("link", { name: "student01" }).getAttribute("href")).toBe("/me");
    expect(screen.getByRole("link", { name: /通知/ }).getAttribute("href")).toBe("/notifications");
    expect(screen.getByText("5")).toBeTruthy();
    expect(screen.getByRole("link", { name: "＋ 提问" }).getAttribute("href")).toBe("/questions/new");
  });
});
