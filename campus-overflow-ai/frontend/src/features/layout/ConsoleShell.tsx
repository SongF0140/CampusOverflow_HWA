"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect } from "react";

import { ForbiddenNotice, LoadingSkeleton } from "@/shared/components";
import { USER_ROLE } from "@/shared/constants/domain";
import { useSessionStore } from "@/shared/stores/session-store";
import { isGraduateAssistant } from "@/shared/utils/assistant";

import { TopNav } from "./TopNav";

export interface ConsoleNavItem {
  href: string;
  label: string;
}

/**
 * 教师端 / 管理端共用外壳：顶栏 + 左侧栏 + 内容区（前端服务需求文档 §3.1）。
 * 角色守卫与需求文档 §3.6 权限表一致：/teacher/** 开放给「助教 / 教师 / 管理员」，
 * 其余角色展示无权限提示，并且**不渲染子页面**（因此不会发出任何请求）。
 */
export function ConsoleShell({
  nav,
  children,
}: {
  nav: ConsoleNavItem[];
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const status = useSessionStore((state) => state.status);
  const me = useSessionStore((state) => state.me);
  const loadMe = useSessionStore((state) => state.loadMe);

  useEffect(() => {
    void loadMe();
  }, [loadMe]);

  // 会话探测中先显示骨架，避免子页面提前发请求
  if (status === "loading") {
    return (
      <div className="mx-auto max-w-[1280px] px-8 py-10">
        <LoadingSkeleton variant="detail" count={3} />
      </div>
    );
  }

  // 会话已失效（Cookie 过期/被清）：引导重新登录，而不是误报"无权限"
  if (!me) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-3 bg-panel px-6 py-10 text-center">
        <p className="text-[18px] font-semibold text-ink">登录状态已失效</p>
        <p className="text-[13px] text-ink-muted">请重新登录后再进入教师端。</p>
        <Link
          href="/auth/login"
          className="co-focusable mt-1 rounded-md bg-brand px-4 py-2 text-[14px] font-medium text-white transition-colors duration-150 ease-standard hover:bg-brand-strong"
        >
          去登录
        </Link>
      </main>
    );
  }

  const allowed =
    me.role === USER_ROLE.teacher ||
    me.role === USER_ROLE.admin ||
    isGraduateAssistant(me);

  if (!allowed) return <ForbiddenNotice />;

  return (
    <div className="min-h-screen bg-panel">
      <TopNav />
      <div className="mx-auto flex max-w-[1280px] flex-col gap-6 px-8 py-6 lg:flex-row">
        <nav aria-label="教师端导航" className="w-full shrink-0 lg:w-[200px]">
          <ul className="flex flex-row gap-1 overflow-x-auto lg:flex-col">
            {nav.map((item) => {
              const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    className={`co-focusable flex min-h-[44px] items-center rounded-md px-3 py-2.5 text-[14px] transition-colors duration-150 ease-standard ${
                      active
                        ? "bg-canvas font-medium text-ink"
                        : "text-ink-muted hover:bg-canvas hover:text-ink"
                    }`}
                  >
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  );
}
