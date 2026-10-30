"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { useSessionStore } from "@/shared/stores/session-store";

// 管理端 / 教师端顶栏共用：退出登录后回登录页（学生端 TopNav 有同款按钮）
export function LogoutButton() {
  const router = useRouter();
  const logout = useSessionStore((state) => state.logout);
  const [pending, setPending] = useState(false);

  async function handleSignOut() {
    if (pending) return;
    setPending(true);
    try {
      await logout();
    } catch {
      // 登出接口失败：store 已在自身 finally 清空本地会话，继续回登录页
    } finally {
      router.replace("/auth/login");
    }
  }

  return (
    <button
      type="button"
      onClick={() => void handleSignOut()}
      disabled={pending}
      aria-busy={pending}
      className="co-focusable cursor-pointer rounded-md border border-line px-3 py-1.5 text-[13px] text-ink-muted transition-colors duration-150 ease-standard hover:bg-panel hover:text-ink"
    >
      {pending ? "退出中…" : "退出"}
    </button>
  );
}
