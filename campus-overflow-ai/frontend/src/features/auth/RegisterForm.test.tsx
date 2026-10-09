import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  register: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: mocks.push }),
}));

vi.mock("@/api/auth", () => ({
  register: mocks.register,
}));

import { ApiError } from "@/api/client";

import { getPasswordStrength, RegisterForm } from "./RegisterForm";

afterEach(() => {
  cleanup();
  mocks.push.mockReset();
  mocks.register.mockReset();
});

function fillValidForm(confirmValue = "Str0ngPass!") {
  fireEvent.change(screen.getByLabelText("用户名"), { target: { value: "stu001" } });
  fireEvent.change(screen.getByLabelText("邮箱"), { target: { value: "stu001@example.com" } });
  fireEvent.change(screen.getByLabelText("密码"), { target: { value: "Str0ngPass!" } });
  fireEvent.change(screen.getByLabelText("确认密码"), { target: { value: confirmValue } });
}

describe("getPasswordStrength", () => {
  it("空密码不出条；按字符种类与长度评弱/中/强", () => {
    expect(getPasswordStrength("")).toBeNull();
    expect(getPasswordStrength("abcdefgh")).toBe("weak"); // 仅 1 类字符
    expect(getPasswordStrength("abcdefgh12")).toBe("medium"); // 2 类字符
    expect(getPasswordStrength("Abcdefgh12")).toBe("strong"); // ≥3 类且 ≥10 位
  });
});

describe("RegisterForm", () => {
  it("两次密码不一致时提交被拦截并行内提示，不调用注册接口", () => {
    render(<RegisterForm />);

    fillValidForm("DifferentPass1");
    fireEvent.click(screen.getByRole("button", { name: "注册" }));

    expect(screen.getByText("两次输入的密码不一致")).toBeTruthy();
    expect(mocks.register).not.toHaveBeenCalled();
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it("用户名不足 3 个字符时失焦行内提示", () => {
    render(<RegisterForm />);

    fireEvent.change(screen.getByLabelText("用户名"), { target: { value: "ab" } });
    fireEvent.blur(screen.getByLabelText("用户名"));

    expect(screen.getByText("用户名需 3~20 个字符")).toBeTruthy();
  });

  it("注册成功后展示 Toast 并跳转登录页（蛇形字段直传后端）", async () => {
    mocks.register.mockResolvedValue({ id: 1, role: "student" });
    render(<RegisterForm />);

    fillValidForm();
    fireEvent.click(screen.getByRole("button", { name: "注册" }));

    await waitFor(() =>
      expect(mocks.register).toHaveBeenCalledWith({
        username: "stu001",
        email: "stu001@example.com",
        password: "Str0ngPass!",
      }),
    );
    await waitFor(() => expect(screen.getByRole("status").textContent).toBe("注册成功，请登录"));
    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith("/auth/login?registered=1"), {
      timeout: 3000,
    });
  });

  it("后端 400（账号已被注册）行内透传 message 且不跳转", async () => {
    mocks.register.mockRejectedValue(new ApiError(400, "用户名或邮箱已被注册。"));
    render(<RegisterForm />);

    fillValidForm();
    fireEvent.click(screen.getByRole("button", { name: "注册" }));

    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("用户名或邮箱已被注册。"));
    expect(mocks.push).not.toHaveBeenCalled();
  });
});
