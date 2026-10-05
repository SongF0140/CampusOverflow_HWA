"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";

import { useNotificationStore } from "@/shared/stores/notification-store";
import { useSessionStore } from "@/shared/stores/session-store";
import type { UserMe } from "@/shared/types/auth";

// 顶栏页签（页面控件级设计说明 §1.1）；当前路由高亮下划线
const NAV_TABS = [
  { label: "问题广场", href: "/" },
  { label: "课程", href: "/courses" },
  { label: "榜单", href: "/rankings" },
  { label: "搜索记录", href: "/search" },
];
// TODO(二期)：AI 助手页签，随 Agent 服务开放

function isActiveTab(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

// 助教能力位（US-20）：学生角色 + 研究生身份 + 认证通过（与后端 require_graduate_assistant 同口径）
export function isGraduateAssistant(me: UserMe): boolean {
  return (
    me.role === "student" &&
    me.identity_type === "postgraduate" &&
    me.assistant_cert_status === "approved"
  );
}

// 用户菜单项按角色渲染（§1.1）：个人中心恒有；教师工作台对教师/助教；管理端仅管理员
export function menuItemsForRole(me: UserMe): { label: string; href: string }[] {
  const items = [{ label: "个人中心", href: "/me" }];
  if (me.role === "teacher" || isGraduateAssistant(me)) {
    items.push({ label: "教师工作台", href: "/teacher" });
  }
  if (me.role === "admin") {
    items.push({ label: "管理端", href: "/admin" });
  }
  return items;
}

// 未读红点数字：超过 99 显示 99+（§1.1）
export function formatUnreadCount(count: number): string {
  return count > 99 ? "99+" : String(count);
}

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

      {/* ≤1024：页签折叠进抽屉（§0.1 断点） */}
      <Drawer
        open={isNavDrawerOpen}
        onClose={() => setIsNavDrawerOpen(false)}
        title="站内导航"
      >
        <DrawerNav pathname={pathname} onNavigate={() => setIsNavDrawerOpen(false)} />
      </Drawer>
    </header>
  );
}

function DesktopTabs({ pathname }: { pathname: string }) {
  return (
    <nav aria-label="站内主导航" className="ml-2 hidden items-center self-stretch lg:flex">
      {NAV_TABS.map((tab) => {
        const isActive = isActiveTab(pathname, tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={isActive ? "page" : undefined}
            className={`co-focusable relative flex h-16 items-center px-3 text-[14px] font-medium transition-colors duration-150 ease-standard ${
              isActive ? "text-brand" : "text-ink-muted hover:text-ink"
            }`}
          >
            {tab.label}
            {isActive ? (
              <span
                aria-hidden="true"
                className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-brand"
              />
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}

function DrawerNav({
  pathname,
  onNavigate,
}: {
  pathname: string;
  onNavigate: () => void;
}) {
  return (
    <nav aria-label="站内导航菜单" className="flex flex-col gap-1">
      {NAV_TABS.map((tab) => {
        const isActive = isActiveTab(pathname, tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            onClick={onNavigate}
            aria-current={isActive ? "page" : undefined}
            className={`co-focusable rounded-md px-3 py-2.5 text-[14px] font-medium transition-colors duration-150 ease-standard ${
              isActive ? "bg-panel text-brand" : "text-ink-muted hover:bg-panel hover:text-ink"
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}

function SearchBox() {
  const router = useRouter();
  const [keyword, setKeyword] = useState("");

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = keyword.trim();
    if (!value) return;
    router.push(`/search?q=${encodeURIComponent(value)}`);
  }

  return (
    <form role="search" onSubmit={handleSubmit} className="flex items-center">
      <input
        value={keyword}
        onChange={(event) => setKeyword(event.target.value)}
        placeholder="搜索问题"
        aria-label="站内搜索"
        className="co-focusable h-9 w-[140px] rounded-md border border-line bg-panel px-3 text-[13px] text-ink transition-colors duration-150 ease-standard placeholder:text-ink-subtle hover:border-ink-subtle focus:border-brand focus:bg-canvas focus:ring-2 focus:ring-brand/20 sm:w-[200px] lg:w-[240px]"
      />
      <button
        type="submit"
        aria-label="搜索"
        className="co-focusable -ml-8 cursor-pointer rounded-md p-1.5 text-ink-subtle transition-colors duration-150 ease-standard hover:text-ink"
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          className="h-4 w-4"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
        >
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" />
        </svg>
      </button>
    </form>
  );
}

function BellIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="h-5 w-5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.7 21a2 2 0 0 1-3.4 0" />
    </svg>
  );
}

function NotificationBell({ unreadCount }: { unreadCount: number | null }) {
  const hasUnread = unreadCount !== null && unreadCount > 0;
  return (
    <Link
      href="/notifications"
      aria-label="通知中心"
      className="co-focusable relative rounded-md p-2 text-ink-muted transition-colors duration-150 ease-standard hover:bg-panel hover:text-ink"
    >
      <BellIcon />
      {hasUnread ? (
        <span
          aria-label={`${formatUnreadCount(unreadCount)} 条未读通知`}
          className="absolute -right-0.5 -top-0.5 min-w-[18px] rounded-full bg-danger px-1 text-center text-[10px] font-semibold leading-[18px] text-white"
        >
          {formatUnreadCount(unreadCount)}
        </span>
      ) : null}
    </Link>
  );
}

function UserMenu({ me, onLogout }: { me: UserMe; onLogout: () => void }) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    function handlePointerDown(event: globalThis.MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setIsOpen(false);
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setIsOpen(false);
    }
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        aria-label="用户菜单"
        aria-haspopup="menu"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((prev) => !prev)}
        className="co-focusable flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1.5 transition-colors duration-150 ease-standard hover:bg-panel"
      >
        <Avatar name={me.username} src={me.avatar_url ?? undefined} size="sm" />
        <span className="hidden max-w-[96px] truncate text-[13px] text-ink sm:inline">
          {me.username}
        </span>
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          className={`h-3.5 w-3.5 text-ink-subtle transition-transform duration-150 ease-standard ${
            isOpen ? "rotate-180" : ""
          }`}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      {isOpen ? (
        <div
          role="menu"
          aria-label="用户菜单"
          className="absolute right-0 top-[calc(100%+6px)] z-50 w-44 overflow-hidden rounded-lg border border-line bg-canvas py-1"
        >
          {menuItemsForRole(me).map((item) => (
            <Link
              key={item.href}
              role="menuitem"
              href={item.href}
              onClick={() => setIsOpen(false)}
              className="co-focusable block px-4 py-2.5 text-[13px] text-ink transition-colors duration-150 ease-standard hover:bg-panel"
            >
              {item.label}
            </Link>
          ))}
          <button
            type="button"
            role="menuitem"
            onClick={onLogout}
            className="co-focusable block w-full cursor-pointer px-4 py-2.5 text-left text-[13px] text-danger transition-colors duration-150 ease-standard hover:bg-panel"
          >
            退出登录
          </button>
        </div>
      ) : null}
    </div>
  );
}
