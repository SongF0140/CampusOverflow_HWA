"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

import { UserLine } from "@/shared/components/UserLine";
import { useSessionStore } from "@/shared/stores/session-store";

import { activeAdminMenuItem } from "./AdminSidebar";

// 管理端顶栏：面包屑（当前菜单名）+ 管理员身份（Avatar + 昵称，§1.3）
export function AdminTopbar() {
  const pathname = usePathname();
  const me = useSessionStore((state) => state.me);
  const status = useSessionStore((state) => state.status);
  const loadMe = useSessionStore((state) => state.loadMe);

  useEffect(() => {
    void loadMe();
  }, [loadMe]);

  const current = activeAdminMenuItem(pathname);

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-canvas">
      <div className="flex h-16 items-center justify-between gap-4 px-6">
        <nav aria-label="当前菜单" className="flex min-w-0 items-center gap-2 text-[13px]">
          <span className="shrink-0 text-ink-subtle">管理端</span>
          <span aria-hidden="true" className="text-ink-subtle">
            /
          </span>
          <span aria-current="page" className="truncate font-medium text-ink">
            {current?.label ?? "治理总览"}
          </span>
        </nav>
        {status === "authed" && me ? (
          <UserLine
            userId={me.id}
            nickname={me.username}
            role={me.role}
            avatarSrc={me.avatar_url ?? undefined}
          />
        ) : null}
      </div>
    </header>
  );
}
