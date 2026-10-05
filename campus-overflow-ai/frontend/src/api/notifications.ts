import type { NotificationListResult } from "@/shared/types/notification";

import { apiFetch } from "./client";

/** 我的通知（GET /api/notifications）：参数是蛇形 unread_only；unread_count 恒为本人全部未读数 */
export function fetchNotifications(
  params: { unreadOnly?: boolean; page?: number; pageSize?: number } = {},
) {
  const query = new URLSearchParams();
  query.set("unread_only", params.unreadOnly ? "true" : "false");
  query.set("page", String(params.page ?? 1));
  query.set("page_size", String(params.pageSize ?? 20));
  return apiFetch<NotificationListResult>(`/notifications?${query.toString()}`);
}

/** 单条已读（幂等）：返回最新未读数 */
export function readNotification(id: number) {
  return apiFetch<{ unread_count: number }>(`/notifications/${id}/read`, { method: "POST" });
}

/** 全部已读（幂等）：返回最新未读数 */
export function readAllNotifications() {
  return apiFetch<{ unread_count: number }>("/notifications/read-all", { method: "POST" });
}
