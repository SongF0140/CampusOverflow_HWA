import type { UserMe, UserProfile } from "@/shared/types/auth";
import type { Paged } from "@/shared/types/common";
import type { PublicReputation, PublicUser } from "@/shared/types/user";

import { apiFetch, buildQuery } from "./client";

/** 当前登录用户（GET /api/users/me）：完整信息含邮箱等隐私字段 */
export function getMe() {
  return apiFetch<UserMe>("/users/me");
}

/** 用户公开信息（GET /api/users/{id}）：无需邮箱，返回不含隐私字段 */
export function getUser(id: number) {
  return apiFetch<PublicUser>(`/users/${id}`);
}

export function fetchPublicUser(id: number) {
  return getUser(id);
}

/** 用户公开声誉（GET /api/users/{id}/reputation） */
export function fetchPublicReputation(id: number) {
  return apiFetch<PublicReputation>(`/users/${id}/reputation`);
}

/**
 * 更新我的资料（PATCH /api/users/me）。
 * TODO(接口差异)：后端 UserUpdateRequest 当前仅消费 bio / avatar_url（username 变更未开放，
 * Pydantic 默认忽略多余字段）；入参先统一接受 username，后端补字段后调用方无需再改。
 */
export function updateMe(input: { username?: string; bio?: string | null; avatar_url?: string }) {
  return apiFetch<UserProfile>("/users/me", {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

/** 用户列表（GET /api/users，管理员）：可选参数缺省不出现 */
export function listUsers(params: { page?: number; page_size?: number; keyword?: string } = {}) {
  return apiFetch<Paged<PublicUser>>(`/users${buildQuery(params)}`);
}

/** 封禁用户（POST /api/users/{id}/ban，管理员）：写审计日志 */
export function banUser(id: number, reason: string) {
  return apiFetch<null>(`/users/${id}/ban`, {
    method: "POST",
    body: JSON.stringify({ reason }),
  });
}

/** 解禁用户（POST /api/users/{id}/unban，管理员）：写审计日志并通知用户 */
export function unbanUser(id: number) {
  return apiFetch<PublicUser>(`/users/${id}/unban`, { method: "POST" });
}

/** 用户公开声誉（GET /api/users/{id}/reputation）的历史命名别名 */
export function getUserReputation(id: number) {
  return fetchPublicReputation(id);
}
