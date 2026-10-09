import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fetchMyCourses: vi.fn(),
  load: vi.fn(),
  user: null as null | {
    role: string;
    identity_type: string;
    assistant_cert_status: string;
  },
}));

// 外壳里渲染了 TopNav，它同时用 usePathname 与 useRouter，两个都要给
vi.mock("next/navigation", () => ({
  usePathname: () => "/teacher",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));
vi.mock("@/shared/stores/session-store", () => ({
  useSessionStore: (selector: (state: unknown) => unknown) =>
    selector({ status: "authed", me: mocks.user, loadMe: mocks.load }),
}));
vi.mock("@/shared/stores/notification-store", () => ({
  useNotificationStore: (selector: (state: unknown) => unknown) =>
    selector({ unreadCount: 0, load: vi.fn() }),
}));
vi.mock("@/api/courses", () => ({ fetchMyCourses: mocks.fetchMyCourses }));

import { fetchMyCourses } from "@/api/courses";
import { ConsoleShell } from "./ConsoleShell";

const NAV = [{ href: "/teacher", label: "工作台" }];

// 探针子页面：一旦被渲染就会发请求，用来验证"无权限时不渲染子页面"
function ProbePage() {
  void fetchMyCourses("probe");
  return <p>教师端内容</p>;
}

function renderShell() {
  return render(
    <ConsoleShell nav={NAV}>
      <ProbePage />
    </ConsoleShell>,
  );
}

beforeEach(() => {
  mocks.fetchMyCourses.mockReset();
  mocks.load.mockReset().mockResolvedValue(undefined);
});

afterEach(cleanup);

describe("ConsoleShell", () => {
  it("教师可进入，渲染左侧导航与子页面", () => {
    mocks.user = { role: "teacher", identity_type: "undergraduate", assistant_cert_status: "none" };
    renderShell();

    expect(screen.getByRole("navigation", { name: "教师端导航" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "工作台" }).getAttribute("href")).toBe("/teacher");
    expect(screen.getByText("教师端内容")).toBeTruthy();
  });

  it("管理员可进入（权限表：/teacher/** 管理员可进）", () => {
    mocks.user = { role: "admin", identity_type: "undergraduate", assistant_cert_status: "none" };
    renderShell();

    expect(screen.getByText("教师端内容")).toBeTruthy();
  });

  it("已认证研究生助教可进入（US-20 能力位）", () => {
    mocks.user = { role: "student", identity_type: "postgraduate", assistant_cert_status: "approved" };
    renderShell();

    expect(screen.getByText("教师端内容")).toBeTruthy();
  });

  it("学生看到无权限提示，且不渲染子页面（不发请求）", async () => {
    mocks.user = { role: "student", identity_type: "undergraduate", assistant_cert_status: "none" };
    renderShell();

    await waitFor(() => expect(screen.getByText("你当前的角色没有访问权限")).toBeTruthy());
    expect(screen.queryByText("教师端内容")).toBeNull();
    expect(mocks.fetchMyCourses).not.toHaveBeenCalled();
  });

  it("会话失效（user 为空）时提示重新登录，而不是误报无权限", async () => {
    mocks.user = null;
    renderShell();

    await waitFor(() => expect(screen.getByText("登录状态已失效")).toBeTruthy());
    expect(screen.getByRole("link", { name: "去登录" }).getAttribute("href")).toBe("/auth/login");
    expect(screen.queryByText("你当前的角色没有访问权限")).toBeNull();
    expect(screen.queryByText("教师端内容")).toBeNull();
    expect(mocks.fetchMyCourses).not.toHaveBeenCalled();
  });
});
