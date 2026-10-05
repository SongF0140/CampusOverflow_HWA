import type { UserProfile } from "@/shared/types/auth";
import type { PublicReputation, PublicUser } from "@/shared/types/user";

import { apiFetch } from "./client";

/** 用户公开信息（GET /api/users/{id}）：无需邮箱，返回不含隐私字段 */
export function fetchPublicUser(id: number) {
  return apiFetch<PublicUser>(`/users/${id}`);
}

/** 用户公开声誉（GET /api/users/{id}/reputation） */
export function fetchPublicReputation(id: number) {
  return apiFetch<PublicReputation>(`/users/${id}/reputation`);
}

/**
 * 更新我的资料（PATCH /api/users/me）：后端 UserUpdateRequest 只接受 bio / avatar_url，
 * bio ≤ 500 字、avatar_url ≤ 255 字。
 */
export function updateMe(input: { bio?: string; avatar_url?: string }) {
  return apiFetch<UserProfile>("/users/me", {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}
