"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";

import { useNotificationStore } from "@/shared/stores/notification-store";
import { useSessionStore } from "@/shared/stores/session-store";

const navLinkClass =
  "co-focusable rounded-md px-2.5 py-2 text-[13px] text-ink-muted transition-colors duration-150 ease-standard hover:bg-panel hover:text-ink";

// 窄屏抽屉项：触控目标 ≥ 44px（设计系统 §2）
const drawerItemClass =
  "co-focusable flex min-h-[44px] items-center justify-between gap-2 rounded-md px-3 py-2.5 text-[14px] text-ink-muted transition-colors duration-150 ease-standard hover:bg-panel hover:text-ink";

const searchInputClass =
  "co-focusable h-9 w-full rounded-md border border-line bg-panel px-3 text-[13px] text-ink transition-colors duration-150 ease-standard placeholder:text-ink-subtle hover:border-ink-subtle focus:border-brand focus:bg-canvas focus:ring-2 focus:ring-brand/20";

/**
 * 学生端顶栏：宽屏（≥1024）一行平铺；窄屏（768 / 480）把主导航折叠进「菜单」抽屉，
 * 与前端服务需求文档「窄屏可滚动，主导航折叠为抽屉」和设计系统断点要求一致。
 */
export function TopNav() {
  const router = useRouter();
  const pathname = usePathname();
  const user = useSessionStore((state) => state.user);
  const load = useSessionStore((state) => state.load);
  const signOut = useSessionStore((state) => state.signOut);
  const unreadCount = useNotificationStore((state) => state.unreadCount);
  const loadUnreadCount = useNotificationStore((state) => state.load);
  const [search, setSearch] = useState("");
  const menuRef = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    void loadMe();
  }, [loadMe]);

  useEffect(() => {
    void loadUnreadCount();
  }, [loadUnreadCount]);

  // 路由变化后收起抽屉（点抽屉里的链接跳转时不会留着一个展开的菜单）
  useEffect(() => {
    menuRef.current?.removeAttribute("open");
  }, [pathname]);

  function closeMenu() {
    menuRef.current?.removeAttribute("open");
  }

  function handleSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = search.trim();
    closeMenu();
    router.push(value ? `/?keyword=${encodeURIComponent(value)}` : "/");
  }

  async function handleSignOut() {
    closeMenu();
    await signOut();
    router.replace("/auth/login");
  }

  const unreadBadge =
    unreadCount > 0 ? (
      <span className="rounded-full bg-danger px-1.5 py-0.5 text-[11px] font-medium leading-none text-white">
        {unreadCount > 99 ? "99+" : unreadCount}
      </span>
    ) : null;

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-canvas">
      <div className="mx-auto flex h-16 max-w-[1280px] items-center gap-3 px-4 sm:px-8">
        <Link href="/" className="co-focusable shrink-0 text-[15px] font-semibold text-ink">
          CampusOverflow
        </Link>

        <form className="hidden flex-1 md:block" onSubmit={handleSearch} role="search">
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="搜索问题、课程、标签"
            aria-label="全站搜索"
            className={`${searchInputClass} max-w-[420px]`}
          />
        </form>

        <div className="ml-auto flex items-center gap-2">
          {/* 宽屏主导航 */}
          <nav className="hidden items-center gap-1 lg:flex" aria-label="主导航">
            <Link href="/courses" className={navLinkClass}>
              课程
            </Link>
            <Link href="/rankings" className={navLinkClass}>
              榜单
            </Link>
            <Link href="/notifications" className={`${navLinkClass} flex items-center gap-1.5`}>
              通知
              {unreadBadge}
            </Link>
            <Link
              href="/questions/new"
              className="co-focusable ml-1 rounded-md bg-brand px-3.5 py-2 text-[13px] font-medium text-white transition-colors duration-150 ease-standard hover:bg-brand-strong"
            >
              ＋ 提问
            </Link>
            {user ? (
              <>
                <Link href="/me" className={`${navLinkClass} ml-1`}>
                  {user.username}
                </Link>
                <button
                  type="button"
                  onClick={() => void handleSignOut()}
                  className="co-focusable cursor-pointer rounded-md border border-line px-3 py-1.5 text-[13px] text-ink-muted transition-colors duration-150 ease-standard hover:bg-panel hover:text-ink"
                >
                  退出
                </button>
              </>
            ) : (
              <Link href="/auth/login" className={`${navLinkClass} ml-1 border border-line`}>
                登录
              </Link>
            )}
          </nav>

          {/* 窄屏：640–1023 保留提问按钮，更窄时收进抽屉 */}
          <Link
            href="/questions/new"
            className="co-focusable hidden shrink-0 rounded-md bg-brand px-3.5 py-2 text-[13px] font-medium text-white transition-colors duration-150 ease-standard hover:bg-brand-strong sm:inline-flex lg:hidden"
          >
            ＋ 提问
          </Link>

          <details ref={menuRef} className="relative lg:hidden">
            <summary
              aria-label="打开主导航菜单"
              className="co-focusable flex h-10 cursor-pointer list-none items-center rounded-md border border-line px-3 text-[13px] text-ink-muted transition-colors duration-150 ease-standard hover:bg-panel [&::-webkit-details-marker]:hidden"
            >
              菜单
            </summary>
            <nav
              aria-label="窄屏主导航"
              className="absolute right-0 z-50 mt-2 flex w-60 flex-col gap-1 rounded-lg border border-line bg-canvas p-2 shadow-lg"
            >
              <form className="p-1 md:hidden" onSubmit={handleSearch} role="search">
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="搜索问题、课程、标签"
                  aria-label="全站搜索"
                  className={`${searchInputClass} h-10`}
                />
              </form>
              <Link href="/courses" className={drawerItemClass}>
                课程
              </Link>
              <Link href="/rankings" className={drawerItemClass}>
                榜单
              </Link>
              <Link href="/notifications" className={drawerItemClass}>
                <span>通知</span>
                {unreadBadge}
              </Link>
              <Link href="/questions/new" className={`${drawerItemClass} sm:hidden`}>
                ＋ 提问
              </Link>
              {user ? (
                <>
                  <Link href="/me" className={drawerItemClass}>
                    <span>个人中心</span>
                    <span className="text-[13px] text-ink-subtle">{user.username}</span>
                  </Link>
                  <button
                    type="button"
                    onClick={() => void handleSignOut()}
                    className={`${drawerItemClass} cursor-pointer border-t border-line text-left`}
                  >
                    退出登录
                  </button>
                </>
              ) : (
                <Link href="/auth/login" className={drawerItemClass}>
                  登录
                </Link>
              )}
            </nav>
          </details>
        </div>
      </div>
    </header>
  );
}
