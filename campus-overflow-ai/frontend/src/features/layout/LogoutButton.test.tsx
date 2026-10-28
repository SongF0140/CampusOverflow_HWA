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
});
