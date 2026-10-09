// 认证域接口：注册/登录走 FastAPI；退出登录由 BFF 合成（JWT 无状态，仅清 Cookie）
import type { LoginResult, UserMe } from "@/shared/types/auth";

import { apiFetch } from "./client";

// POST /auth/register：注册成功默认学生角色，回包为完整用户信息
export function register(input: { username: string; email: string; password: string }) {
  return apiFetch<UserMe>("/auth/register", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

// POST /auth/login：account 支持用户名或邮箱；token 由 BFF 写入 HttpOnly Cookie
export function login(input: { account: string; password: string }) {
  return apiFetch<LoginResult>("/auth/login", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

// GET /users/me：当前登录用户完整信息
export function fetchMe() {
  return apiFetch<UserMe>("/users/me");
}

// 后端 JWT 无状态，退出由 BFF 清除 HttpOnly Cookie
export function logout() {
  return apiFetch<null>("/auth/logout", { method: "POST" });
}
