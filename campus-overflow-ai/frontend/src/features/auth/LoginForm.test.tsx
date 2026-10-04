import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  replace: vi.fn(),
  signIn: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mocks.replace, push: vi.fn() }),
}));

vi.mock("@/shared/stores/session-store", () => ({
  useSessionStore: (selector: (state: { signIn: typeof mocks.signIn }) => unknown) =>
    selector({ signIn: mocks.signIn }),
  homePathFor: (role: string) =>
    role === "admin" ? "/admin" : role === "teacher" ? "/teacher" : "/",
}));

import { ApiError } from "@/api/client";

import { LoginForm } from "./LoginForm";

afterEach(() => {
  cleanup();
  mocks.replace.mockReset();
  mocks.signIn.mockReset();
});

function fillAndSubmit() {
  fireEvent.change(screen.getByLabelText("用户名或邮箱"), { target: { value: "stu001" } });
  fireEvent.change(screen.getByLabelText("密码"), { target: { value: "fake-password" } });
  fireEvent.click(screen.getByRole("button", { name: "登录" }));
}

describe("LoginForm", () => {
  it("登录成功后回到站内 returnTo", async () => {
    mocks.signIn.mockResolvedValue({ id: 1, role: "student" });
    render(<LoginForm returnTo="/me" />);

    fillAndSubmit();

    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith("/me"));
  });

  it("returnTo 为站外地址时回落到角色首页（防开放重定向）", async () => {
    mocks.signIn.mockResolvedValue({ id: 1, role: "teacher" });
    render(<LoginForm returnTo="//evil.com" />);

    fillAndSubmit();

    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith("/teacher"));
    expect(mocks.replace).not.toHaveBeenCalledWith("//evil.com");
  });

  it("登录失败时展示中文提示且不跳转", async () => {
    mocks.signIn.mockRejectedValue(new ApiError(401, "账号或密码错误"));
    render(<LoginForm />);

    fillAndSubmit();

    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("账号或密码错误"));
    expect(mocks.replace).not.toHaveBeenCalled();
  });
});
