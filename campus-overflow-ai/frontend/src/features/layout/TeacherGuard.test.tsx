import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  session: {
    me: null as unknown,
    status: "authed",
    loadMe: null as unknown,
  },
}));

vi.mock("@/shared/stores/session-store", () => ({
  useSessionStore: (selector: (state: typeof mocks.session) => unknown) => selector(mocks.session),
}));

import type { UserMe } from "@/shared/types/auth";

import { TeacherGuard } from "./TeacherGuard";

function user(patch: Partial<UserMe>): UserMe {
  return {
    id: 1,
    username: "someone",
    email: "someone@campus.edu",
    role: "student",
    status: "active",
    ban_reason: null,
    identity_type: "undergraduate",
    assistant_cert_status: "none",
    reputation_score: 0,
    bio: null,
    avatar_url: null,
    created_at: "2026-09-01T10:00:00+08:00",
    ...patch,
  };
}

function renderGuard() {
  return render(
    <TeacherGuard>
      <p>教师端子页面</p>
    </TeacherGuard>,
  );
}

beforeEach(() => {
  mocks.session.status = "authed";
  mocks.session.me = user({ role: "teacher" });
  mocks.session.loadMe = async () => {};
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("TeacherGuard", () => {
  it("教师放行子页面", () => {
    renderGuard();
    expect(screen.getByText("教师端子页面")).toBeTruthy();
  });

  it("管理员放行子页面", () => {
    mocks.session.me = user({ role: "admin" });
    renderGuard();
    expect(screen.getByText("教师端子页面")).toBeTruthy();
  });

  // 评审要求：助教是学生角色上的能力位（US-20 / E-12 / Q-07），其能力在学生端，
  // 放行整个 /teacher/** 会越出能力边界
  it("已认证研究生助教不放行，且不渲染子页面", () => {
    mocks.session.me = user({
      role: "student",
      identity_type: "postgraduate",
      assistant_cert_status: "approved",
    });
    renderGuard();
    expect(screen.getByText("你当前的角色没有访问权限")).toBeTruthy();
    expect(screen.queryByText("教师端子页面")).toBeNull();
  });

  it("普通学生不放行", () => {
    mocks.session.me = user({ role: "student" });
    renderGuard();
    expect(screen.queryByText("教师端子页面")).toBeNull();
  });

  it("登录态未就绪时渲染骨架，不渲染子页面", () => {
    mocks.session.status = "loading";
    mocks.session.me = null;
    renderGuard();
    expect(screen.queryByText("教师端子页面")).toBeNull();
  });

  it("未登录（guest）不渲染子页面", () => {
    mocks.session.status = "guest";
    mocks.session.me = null;
    renderGuard();
    expect(screen.queryByText("教师端子页面")).toBeNull();
  });
});
