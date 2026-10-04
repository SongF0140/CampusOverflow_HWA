import type { LoginResult, UserProfile } from "@/shared/types/auth";

import { apiFetch } from "./client";

export function register(input: { username: string; email: string; password: string }) {
  return apiFetch<UserProfile>("/auth/register", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function login(input: { account: string; password: string }) {
  return apiFetch<LoginResult>("/auth/login", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function fetchMe() {
  return apiFetch<UserProfile>("/users/me");
}

// 后端 JWT 无状态，退出由 BFF 清除 HttpOnly Cookie
export function logout() {
  return apiFetch<null>("/auth/logout", { method: "POST" });
}
