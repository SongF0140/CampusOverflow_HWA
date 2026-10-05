"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";

import { useSessionStore } from "@/shared/stores/session-store";
import { useNotificationStore } from "@/shared/stores/notification-store";

export function TopNav() {
  const router = useRouter();
  const user = useSessionStore((state) => state.user);
  const load = useSessionStore((state) => state.load);
  const signOut = useSessionStore((state) => state.signOut);
  const unreadCount = useNotificationStore((state) => state.unreadCount);
  const loadUnreadCount = useNotificationStore((state) => state.load);
  const [search, setSearch] = useState("");

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void loadUnreadCount();
  }, [loadUnreadCount]);

  function handleSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = search.trim();
    router.push(value ? `/?keyword=${encodeURIComponent(value)}` : "/");
  }

  async function handleSignOut() {
    await signOut();
    router.replace("/auth/login");
  }

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-canvas">
      <div className="mx-auto flex h-16 max-w-[1280px] items-center gap-4 px-8">
        <Link href="/" className="co-focusable text-[15px] font-semibold text-ink">
          CampusOverflow
        </Link>

        <form className="flex-1" onSubmit={handleSearch} role="search">
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="搜索问题、课程、标签"
            aria-label="全站搜索"
            className="co-focusable h-9 w-full max-w-[420px] rounded-md border border-line bg-panel px-3 text-[13px] text-ink transition-colors duration-150 ease-standard placeholder:text-ink-subtle hover:border-ink-subtle focus:border-brand focus:bg-canvas focus:ring-2 focus:ring-brand/20"
          />
        </form>

        <Link
          href="/questions/new"
          className="co-focusable rounded-md bg-brand px-3.5 py-2 text-[13px] font-medium text-white transition-colors duration-150 ease-standard hover:bg-brand-strong"
        >
          ＋ 提问
        </Link>
        <Link
          href="/notifications"
          className="co-focusable rounded-md px-2.5 py-2 text-[13px] text-ink-muted transition-colors duration-150 ease-standard hover:bg-panel hover:text-ink"
        >
          通知
          {unreadCount > 0 ? (
            <span className="ml-1.5 rounded-full bg-danger px-1.5 py-0.5 text-[11px] font-medium leading-none text-white">
              {unreadCount > 99 ? "99+" : unreadCount}
            </span>
          ) : null}
        </Link>

        {user ? (
          <div className="flex items-center gap-2">
            <Link
              href="/me"
              className="co-focusable text-[13px] text-ink-muted hover:text-brand"
            >
              {user.username}
            </Link>
            <button
              type="button"
              onClick={() => void handleSignOut()}
              className="co-focusable cursor-pointer rounded-md border border-line px-3 py-1.5 text-[13px] text-ink-muted transition-colors duration-150 ease-standard hover:bg-panel hover:text-ink"
            >
              退出
            </button>
          </div>
        ) : (
          <Link
            href="/auth/login"
            className="co-focusable rounded-md border border-line px-3 py-1.5 text-[13px] text-ink transition-colors duration-150 ease-standard hover:bg-panel"
          >
            登录
          </Link>
        )}
      </div>
    </header>
  );
}
