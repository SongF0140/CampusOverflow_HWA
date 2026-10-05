import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { UserMe } from "@/shared/types/auth";

const mocks = vi.hoisted(() => ({
  pathname: "/admin",
  me: null as UserMe | null,
  status: "guest" as "loading" | "authed" | "guest",
  loadMe: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => mocks.pathname,
}));

interface SessionShape {
  me: UserMe | null;
  status: "loading" | "authed" | "guest";
  loadMe: () => Promise<void>;
}

vi.mock("@/shared/stores/session-store", () => ({
  useSessionStore: (selector: (state: SessionShape) => unknown) =>
    selector({
      me: mocks.me,
      status: mocks.status,
      loadMe: mocks.loadMe,
    } satisfies SessionShape),
}));

import { activeAdminMenuItem, ADMIN_MENU_ITEMS, AdminSidebar } from "./AdminSidebar";
import { AdminShell } from "./AdminShell";

function makeAdminMe(): UserMe {
  return {
    id: 9,
    username: "admin01",
    email: "admin01@campus.edu",
    role: "admin",
    status: "active",
    ban_reason: null,
    identity_type: "admin",
    assistant_cert_status: "none",
    reputation_score: 0,
    bio: null,
    avatar_url: null,
    created_at: "2026-09-01T08:00:00",
  };
}

beforeEach(() => {
  mocks.loadMe.mockReset();
  mocks.pathname = "/admin";
  mocks.me = null;
  mocks.status = "guest";
});

afterEach(cleanup);

describe("AdminSidebar 菜单渲染", () => {
  it("渲染 6 个可点菜单项，href 与路由一一对应", () => {
    render(<AdminSidebar />);
    const expected: Array<[string, string]> = [
      ["治理总览", "/admin"],
      ["用户管理", "/admin/users"],
      ["课程管理", "/admin/courses"],
      ["审核队列", "/admin/moderation/cases"],
      ["审批中心", "/admin/moderation/approvals"],
      ["申诉处理", "/admin/moderation/appeals"],
    ];
    for (const [label, href] of expected) {
      const link = screen.getByRole("link", { name: label }) as HTMLAnchorElement;
      expect(link.getAttribute("href")).toBe(href);
    }
  });

  it("Agent 运行入口置灰不可点，带「二期」角标与 tooltip", () => {
    render(<AdminSidebar />);
    expect(screen.queryByRole("link", { name: /Agent 运行/ })).toBeNull();
    expect(screen.getByText("Agent 运行")).toBeTruthy();
    expect(screen.getByText("二期")).toBeTruthy();
    expect(screen.getByTitle("随 Agent 服务开放")).toBeTruthy();
  });

  it("当前路由对应菜单高亮（aria-current）", () => {
    mocks.pathname = "/admin/moderation/cases";
    render(<AdminSidebar />);
    expect(screen.getByRole("link", { name: "审核队列" }).getAttribute("aria-current")).toBe(
      "page",
    );
    expect(screen.getByRole("link", { name: "治理总览" }).getAttribute("aria-current")).toBeNull();
  });
});

describe("activeAdminMenuItem（最长前缀优先）", () => {
  it("根路径与嵌套路径命中正确菜单项", () => {
    expect(activeAdminMenuItem("/admin")?.key).toBe("overview");
    expect(activeAdminMenuItem("/admin/users")?.key).toBe("users");
    expect(activeAdminMenuItem("/admin/moderation/cases")?.key).toBe("moderation-cases");
    expect(activeAdminMenuItem("/admin/moderation/cases/42")?.key).toBe("moderation-cases");
    expect(activeAdminMenuItem("/me")).toBeNull();
  });

  it("菜单清单恰好 7 项，Agent 运行为唯一 disabled 项", () => {
    expect(ADMIN_MENU_ITEMS).toHaveLength(7);
    expect(ADMIN_MENU_ITEMS.filter((item) => item.disabled).map((item) => item.key)).toEqual([
      "agent-runs",
    ]);
  });
});

describe("AdminShell 整体", () => {
  it("侧栏 + 顶栏面包屑 + 内容区组合渲染，面包屑显示当前菜单名", () => {
    mocks.pathname = "/admin/users";
    render(
      <AdminShell>
        <div>内容占位</div>
      </AdminShell>,
    );
    const breadcrumb = screen.getByRole("navigation", { name: "当前菜单" });
    expect(breadcrumb.textContent).toContain("管理端");
    expect(breadcrumb.textContent).toContain("用户管理");
    expect(screen.getByText("内容占位")).toBeTruthy();
  });

  it("登录就绪后顶栏显示管理员身份（昵称）", () => {
    mocks.status = "authed";
    mocks.me = makeAdminMe();
    render(
      <AdminShell>
        <div>内容占位</div>
      </AdminShell>,
    );
    expect(screen.getByText("admin01")).toBeTruthy();
  });

  it("登录态未就绪时顶栏不渲染身份条（守卫保证已登录）", () => {
    render(
      <AdminShell>
        <div>内容占位</div>
      </AdminShell>,
    );
    expect(screen.queryByText("admin01")).toBeNull();
  });
});
