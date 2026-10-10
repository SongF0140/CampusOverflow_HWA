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
import { toInternalPath } from "@/shared/utils/redirect";

import { LoginForm } from "./LoginForm";

afterEach(() => {
  cleanup();
  mocks.replace.mockReset();
  mocks.signIn.mockReset();
});

function fillAndSubmit() {
  fireEvent.change(screen.getByLabelText("账号"), { target: { value: "stu001" } });
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

  it("无 returnTo 时按角色分流到对应端首页", async () => {
    mocks.signIn.mockResolvedValue({ id: 1, role: "admin" });
    render(<LoginForm />);

    fillAndSubmit();

    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith("/admin"));
  });

  it("账号或密码为空时失焦即行内提示，且不发起登录", () => {
    render(<LoginForm />);

    fireEvent.blur(screen.getByLabelText("账号"));
    fireEvent.blur(screen.getByLabelText("密码"));

    expect(screen.getByText("请输入账号")).toBeTruthy();
    expect(screen.getByText("请输入密码")).toBeTruthy();
    expect(mocks.signIn).not.toHaveBeenCalled();
  });

  it("401 时行内展示固定文案「账号或密码不正确」且不跳转", async () => {
    mocks.signIn.mockRejectedValue(new ApiError(401, "账号或密码错误"));
    render(<LoginForm />);

    fillAndSubmit();

    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("账号或密码不正确"));
    expect(mocks.replace).not.toHaveBeenCalled();
  });

  it("非 401 错误透传后端中文 message（如封禁提示）", async () => {
    mocks.signIn.mockRejectedValue(new ApiError(403, "账号已被封禁，请联系管理员。"));
    render(<LoginForm />);

    fillAndSubmit();

    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toBe("账号已被封禁，请联系管理员。"),
    );
    expect(mocks.replace).not.toHaveBeenCalled();
  });

  it("明文切换按钮可切换密码输入框类型", () => {
    render(<LoginForm />);

    const passwordInput = screen.getByLabelText("密码") as HTMLInputElement;
    expect(passwordInput.type).toBe("password");

    fireEvent.click(screen.getByRole("button", { name: "显示密码" }));
    expect(passwordInput.type).toBe("text");

    fireEvent.click(screen.getByRole("button", { name: "隐藏密码" }));
    expect(passwordInput.type).toBe("password");
  });
});
