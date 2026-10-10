"use client";

import { create } from "zustand";

import { login as loginApi, logout as logoutApi } from "@/api/auth";
import { getMe } from "@/api/users";
import type { UserMe, UserRole } from "@/shared/types/auth";

// 登录态三态：loading 首次探测中 / authed 已登录 / guest 未登录或凭证失效
type SessionStatus = "loading" | "authed" | "guest";

interface SessionState {
  me: UserMe | null;
  status: SessionStatus;
  // 探测登录态：成功 → authed；401（未登录/过期）及其他错误 → guest，由调用方决定是否跳登录页
  loadMe: () => Promise<void>;
  signIn: (account: string, password: string) => Promise<UserMe>;
  // 退出：调 BFF 合成的登出接口清 Cookie，再清本地状态（幂等）
  logout: () => Promise<void>;
}

// 登录态只放在内存：真实凭证在 HttpOnly Cookie 里，前端读不到也不需要读
export const useSessionStore = create<SessionState>((set, get) => ({
  me: null,
  status: "loading",
  loadMe: async () => {
    // 已有登录态时静默刷新：若退回 loading，按 status 卸载子页面的守卫（TeacherGuard）会
    // 与子页面自身的 loadMe() 互相触发，导致子页面反复重挂 + 无限请求
    if (!get().me) set({ status: "loading" });
    try {
      const me = await getMe();
      set({ me, status: "authed" });
    } catch {
      set({ me: null, status: "guest" });
    }
  },
  signIn: async (account, password) => {
    const result = await loginApi({ account, password });
    set({ me: result.user, status: "authed" });
    return result.user;
  },
  logout: async () => {
    try {
      await logoutApi();
    } finally {
      set({ me: null, status: "guest" });
    }
  },
}));

// 登录后按角色落地：管理员 → 治理总览，教师 → 教师工作台，其余 → 问题广场
export function homePathFor(role: UserRole): string {
  if (role === "admin") return "/admin";
  if (role === "teacher") return "/teacher";
  return "/";
}
