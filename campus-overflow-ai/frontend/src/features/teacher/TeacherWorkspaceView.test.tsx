import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  // session-store 以可变对象模拟，按用例切换登录态（参考 MePanel.test）
  session: {
    status: "authed",
    me: null as unknown,
    loadMe: vi.fn(),
  },
}));

vi.mock("@/shared/stores/session-store", () => ({
  useSessionStore: (selector: (state: typeof mocks.session) => unknown) =>
    selector(mocks.session),
}));

import type { UserMe } from "@/shared/types/auth";

import { TeacherWorkspaceView } from "./TeacherWorkspaceView";

const MOCK_ME: UserMe = {
  id: 7,
  username: "王老师",
  email: "wang@campus.edu",
  role: "teacher",
  status: "active",
  ban_reason: null,
  identity_type: "undergraduate",
  assistant_cert_status: "none",
  reputation_score: 120,
  bio: null,
  avatar_url: null,
  created_at: "2026-09-01T10:00:00+08:00",
};

function linkByLabel(label: RegExp): HTMLAnchorElement {
  return screen.getByRole("link", { name: label }) as HTMLAnchorElement;
}

function tabByName(name: string): HTMLButtonElement {
  return screen.getByRole("tab", { name }) as HTMLButtonElement;
}

describe("TeacherWorkspaceView", () => {
  beforeEach(() => {
    mocks.session.status = "authed";
    mocks.session.me = { ...MOCK_ME };
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  // 回归：本页不再自行 loadMe。守卫按 status 卸载子页面，子页面若同时 loadMe 会把 status
  // 退回 loading → 子页面反复重挂 + 无限请求（登录态由 app/teacher/layout 的 TeacherGuard 统一探测）
  it("不自行探测登录态（交给 TeacherGuard）", () => {
    render(<TeacherWorkspaceView />);

    expect(mocks.session.loadMe).not.toHaveBeenCalled();
  });

  it("登录态渲染四张指标卡：数字以 '-' 占位，导航 href 正确", () => {
    render(<TeacherWorkspaceView />);

    expect(linkByLabel(/我的课程/).getAttribute("href")).toBe("/teacher/courses");
    expect(linkByLabel(/待处理工单/).getAttribute("href")).toBe("/teacher/moderation");
    expect(linkByLabel(/待审核问题/).getAttribute("href")).toBe("/teacher/certify");
    expect(linkByLabel(/我的回答/).getAttribute("href")).toBe("/users/7");
    // TODO(接口差异) 对应：无聚合指标接口，四个数字均为占位 "-"
    expect(screen.getAllByText("-")).toHaveLength(4);
  });

  it("工单区 Tab 为组件状态切换：默认待处理，可切历史；空态文案固定", () => {
    render(<TeacherWorkspaceView />);

    expect(tabByName("待处理").getAttribute("aria-selected")).toBe("true");

    fireEvent.click(tabByName("历史"));
    expect(tabByName("历史").getAttribute("aria-selected")).toBe("true");
    expect(tabByName("待处理").getAttribute("aria-selected")).toBe("false");
    // governance 工单接口 501 占位：两个 Tab 下均为同一空态
    expect(screen.getByText("工单接口随二期开放")).toBeTruthy();
  });

  it("动态调课区渲染空态", () => {
    render(<TeacherWorkspaceView />);

    expect(screen.getByText("暂无调课通知")).toBeTruthy();
  });

  it("guest 态渲染登录引导，不渲染指标卡", () => {
    mocks.session.status = "guest";
    mocks.session.me = null;
    render(<TeacherWorkspaceView />);

    expect(screen.getByText("登录后查看教师工作台")).toBeTruthy();
    expect(screen.queryByRole("link", { name: /我的课程/ })).toBeNull();
  });

  it("加载态渲染骨架屏，不渲染指标卡", () => {
    mocks.session.status = "loading";
    mocks.session.me = null;
    render(<TeacherWorkspaceView />);

    expect(screen.getByText("正在加载教师工作台")).toBeTruthy();
    expect(screen.queryByRole("link", { name: /我的课程/ })).toBeNull();
  });
});
