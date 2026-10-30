import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  replace: vi.fn(),
  logout: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mocks.replace }),
}));

vi.mock("@/shared/stores/session-store", () => ({
  useSessionStore: (selector: (state: { logout: () => Promise<void> }) => unknown) =>
    selector({ logout: mocks.logout }),
}));

import { LogoutButton } from "./LogoutButton";

describe("LogoutButton", () => {
  beforeEach(() => {
    mocks.replace.mockReset();
    mocks.logout.mockReset();
    mocks.logout.mockResolvedValue(undefined);
  });

  afterEach(cleanup);

  it("点击退出：调用 logout 并回到登录页", async () => {
    render(<LogoutButton />);
    fireEvent.click(screen.getByRole("button", { name: "退出" }));

    await waitFor(() => expect(mocks.logout).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith("/auth/login"));
  });

  it("登出接口失败：仍然回到登录页（会话已本地清空）", async () => {
    mocks.logout.mockRejectedValue(new Error("network down"));
    render(<LogoutButton />);
    fireEvent.click(screen.getByRole("button", { name: "退出" }));

    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith("/auth/login"));
  });

  it("请求进行中重复点击：只调用一次 logout", async () => {
    let resolveLogout: () => void = () => {};
    mocks.logout.mockReturnValue(
      new Promise<void>((resolve) => {
        resolveLogout = resolve;
      }),
    );
    render(<LogoutButton />);
    const button = screen.getByRole("button", { name: "退出" });

    fireEvent.click(button);
    await waitFor(() => expect(button.textContent).toBe("退出中…"));
    fireEvent.click(button);

    expect(mocks.logout).toHaveBeenCalledTimes(1);
    expect((button as HTMLButtonElement).disabled).toBe(true);
    resolveLogout();
    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith("/auth/login"));
  });
});
