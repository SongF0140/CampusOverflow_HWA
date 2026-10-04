import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  updateMe: vi.fn(),
  load: vi.fn(),
}));

vi.mock("@/api/users", () => ({ updateMe: mocks.updateMe }));
vi.mock("@/shared/stores/session-store", () => {
  const user = {
    id: 2,
    username: "student01",
    email: "student01@example.com",
    role: "student",
    status: "active",
    ban_reason: null,
    identity_type: "undergraduate",
    assistant_cert_status: "none",
    reputation_score: 15,
    bio: "旧简介",
    avatar_url: null,
    created_at: "2026-10-04T14:24:05",
  };
  return {
    useSessionStore: (selector: (state: { user: typeof user; status: string; load: () => Promise<void> }) => unknown) =>
      selector({ user, status: "ready", load: mocks.load }),
  };
});

import { ProfileForm } from "./ProfileForm";

beforeEach(() => {
  mocks.updateMe.mockReset().mockResolvedValue({ id: 2 });
  mocks.load.mockReset().mockResolvedValue(undefined);
});

afterEach(cleanup);

describe("ProfileForm", () => {
  it("预填当前资料并展示只读信息（用户名/角色/邮箱）", async () => {
    render(<ProfileForm />);

    await waitFor(() => expect(screen.getByDisplayValue("旧简介")).toBeTruthy());
    expect(screen.getByText("student01")).toBeTruthy();
    expect(screen.getByText("学生")).toBeTruthy();
    expect(screen.getByText("student01@example.com")).toBeTruthy();
  });

  it("保存成功后调用 PATCH 并刷新登录态", async () => {
    render(<ProfileForm />);
    await waitFor(() => expect(screen.getByDisplayValue("旧简介")).toBeTruthy());

    fireEvent.change(screen.getByDisplayValue("旧简介"), { target: { value: "新简介" } });
    fireEvent.click(screen.getByRole("button", { name: "保存资料" }));

    await waitFor(() =>
      expect(mocks.updateMe).toHaveBeenCalledWith({ bio: "新简介", avatar_url: "" }),
    );
    await waitFor(() => expect(screen.getByText("资料已保存")).toBeTruthy());
    expect(mocks.load).toHaveBeenCalled();
  });

  it("简介超长时本地拦截，不发请求", async () => {
    render(<ProfileForm />);
    await waitFor(() => expect(screen.getByDisplayValue("旧简介")).toBeTruthy());

    // maxLength 会挡住直接输入，这里直接构造超长值验证校验分支
    const textarea = screen.getByDisplayValue("旧简介") as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "长".repeat(501) } });
    fireEvent.click(screen.getByRole("button", { name: "保存资料" }));

    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("不能超过 500"));
    expect(mocks.updateMe).not.toHaveBeenCalled();
  });
});
