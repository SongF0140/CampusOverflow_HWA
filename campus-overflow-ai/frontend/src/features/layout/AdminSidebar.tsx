"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// 管理端侧栏菜单（页面控件级设计说明 §1.3）：菜单项即路由入口
export interface AdminMenuItem {
  key: string;
  label: string;
  href: string;
  disabled?: boolean;
}

export const ADMIN_MENU_ITEMS: AdminMenuItem[] = [
  { key: "overview", label: "治理总览", href: "/admin" },
  { key: "users", label: "用户管理", href: "/admin/users" },
  { key: "courses", label: "课程管理", href: "/admin/courses" },
  { key: "moderation-cases", label: "审核队列", href: "/admin/moderation/cases" },
  { key: "moderation-approvals", label: "审批中心", href: "/admin/moderation/approvals" },
  { key: "moderation-appeals", label: "申诉处理", href: "/admin/moderation/appeals" },
  // TODO(二期)：Agent 运行记录页（/admin/agent/runs），随 Agent 服务开放
  { key: "agent-runs", label: "Agent 运行", href: "/admin/agent/runs", disabled: true },
];

// 嵌套路径命中多条时取最长前缀（如 /admin/moderation/cases 优先于 /admin）
export function activeAdminMenuItem(pathname: string): AdminMenuItem | null {
  const hits = ADMIN_MENU_ITEMS.filter(
    (item) => !item.disabled && (pathname === item.href || pathname.startsWith(`${item.href}/`)),
  );
  return hits.sort((a, b) => b.href.length - a.href.length)[0] ?? null;
}

export function AdminSidebar() {
  const pathname = usePathname();
  const active = activeAdminMenuItem(pathname);

  return (
    <aside aria-label="管理端导航" className="w-[240px] shrink-0 border-r border-line bg-panel">
      <div className="sticky top-0 flex h-screen flex-col gap-1 overflow-y-auto p-4">
        <p className="px-3 pb-3 text-[13px] font-semibold text-ink-subtle">管理端</p>
        {ADMIN_MENU_ITEMS.map((item) =>
          item.disabled ? (
            <span
              key={item.key}
              aria-disabled="true"
              title="随 Agent 服务开放"
              className="flex cursor-not-allowed items-center justify-between rounded-md px-3 py-2.5 text-[14px] text-ink-subtle opacity-70"
            >
              {item.label}
              <span className="rounded-sm bg-warning-soft px-1.5 py-0.5 text-[11px] font-medium text-warning-ink">
                二期
              </span>
            </span>
          ) : (
            <Link
              key={item.key}
              href={item.href}
              aria-current={active?.key === item.key ? "page" : undefined}
              className={`co-focusable rounded-md px-3 py-2.5 text-[14px] font-medium transition-colors duration-150 ease-standard ${
                active?.key === item.key
                  ? "bg-canvas text-brand"
                  : "text-ink-muted hover:bg-canvas hover:text-ink"
              }`}
            >
              {item.label}
            </Link>
          ),
        )}
      </div>
    </aside>
  );
}
