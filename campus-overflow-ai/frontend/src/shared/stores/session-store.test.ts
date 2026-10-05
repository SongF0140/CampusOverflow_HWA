import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/api/client";
import type { UserMe } from "@/shared/types/auth";

// mock 掉真实接口层：store 测试不依赖网络
const mocks = vi.hoisted(() => ({
  login: vi.fn(),
  logout: vi.fn(),
  getMe: vi.fn(),
}));

vi.mock("@/api/auth", () => ({
  login: mocks.login,
  logout: mocks.logout,
  fetchMe: mocks.getMe,
}));

vi.mock("@/api/users", () => ({
  getMe: mocks.getMe,
}));

import { homePathFor, useSessionStore } from "./session-store";

const fakeMe: UserMe = {
  id: 1,
  username: "stu001",
  email: "stu001@campus.edu",
  role: "student",
  status: "active",
  ban_reason: null,
  identity_type: "undergraduate",
  assistant_cert_status: "none",
  reputation_score: 20,
  bio: null,
  avatar_url: null,
  created_at: "2026-09-01T08:00:00",
};

beforeEach(() => {
  useSessionStore.setState({ me: null, status: "loading" });
  mocks.login.mockReset();
  mocks.logout.mockReset();
  mocks.getMe.mockReset();
});

describe("session-store.loadMe", () => {
  it("成功时置 authed 并写入 me", async () => {
    mocks.getMe.mockResolvedValue(fakeMe);

    await useSessionStore.getState().loadMe();

    expect(useSessionStore.getState().status).toBe("authed");
    expect(useSessionStore.getState().me).toEqual(fakeMe);
  });

  it("401 时回退 guest 且清空 me（不自动跳转，由调用方决定）", async () => {
    mocks.getMe.mockRejectedValue(new ApiError(401, "未登录"));

    await useSessionStore.getState().loadMe();

    expect(useSessionStore.getState().status).toBe("guest");
    expect(useSessionStore.getState().me).toBeNull();
  });
});

describe("session-store.signIn / logout", () => {
  it("登录成功置 authed 并返回用户", async () => {
    mocks.login.mockResolvedValue({
      access_token: "unused",
      token_type: "bearer",
      user: fakeMe,
    });

    const me = await useSessionStore.getState().signIn("stu001", "fake-password");

    expect(me).toEqual(fakeMe);
    expect(useSessionStore.getState().status).toBe("authed");
    expect(mocks.login).toHaveBeenCalledWith({
      account: "stu001",
      password: "fake-password",
    });
  });

  it("退出时调用登出接口，接口失败也照样清为 guest", async () => {
    useSessionStore.setState({ me: fakeMe, status: "authed" });
    mocks.logout.mockRejectedValue(new ApiError(500, "网络异常"));

    // 登出接口失败会向上抛出，但本地状态必须在 finally 中清理
    await expect(useSessionStore.getState().logout()).rejects.toBeInstanceOf(ApiError);

    expect(mocks.logout).toHaveBeenCalledTimes(1);
    expect(useSessionStore.getState().me).toBeNull();
    expect(useSessionStore.getState().status).toBe("guest");
  });
});

describe("homePathFor", () => {
  it("按角色落到对应首页", () => {
    expect(homePathFor("admin")).toBe("/admin");
    expect(homePathFor("teacher")).toBe("/teacher");
    expect(homePathFor("student")).toBe("/");
  });
});
