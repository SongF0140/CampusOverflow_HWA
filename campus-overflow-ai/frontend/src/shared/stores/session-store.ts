"use client";

import { create } from "zustand";

import { fetchMe, login as loginApi, logout as logoutApi } from "@/api/auth";
import type { UserProfile, UserRole } from "@/shared/types/auth";

type SessionStatus = "idle" | "loading" | "ready";

interface SessionState {
  user: UserProfile | null;
  status: SessionStatus;
  load: () => Promise<void>;
  signIn: (account: string, password: string) => Promise<UserProfile>;
  signOut: () => Promise<void>;
}

// 登录态只放在内存：真实凭证在 HttpOnly Cookie 里，前端读不到也不需要读
export const useSessionStore = create<SessionState>((set) => ({
  user: null,
  status: "idle",
  load: async () => {
    set({ status: "loading" });
    try {
      const user = await fetchMe();
      set({ user, status: "ready" });
    } catch {
      set({ user: null, status: "ready" });
    }
  },
  signIn: async (account, password) => {
    const result = await loginApi({ account, password });
    set({ user: result.user, status: "ready" });
    return result.user;
  },
  signOut: async () => {
    try {
      await logoutApi();
    } finally {
      set({ user: null, status: "ready" });
    }
  },
}));

// 登录后按角色落地：管理员 → 治理总览，教师 → 教师工作台，其余 → 问题广场
export function homePathFor(role: UserRole): string {
  if (role === "admin") return "/admin";
  if (role === "teacher") return "/teacher";
  return "/";
}
