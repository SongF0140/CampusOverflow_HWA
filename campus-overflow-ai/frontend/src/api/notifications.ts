import type { NotificationListResult } from "@/shared/types/notification";

import { apiFetch, buildQuery } from "./client";

/** 我的通知（GET /api/notifications）：蛇形可选参数，缺省不出现 */
export function listNotifications(
  params: { unread_only?: boolean; page?: number; page_size?: number } = {},
) {
  return apiFetch<NotificationListResult>(`/notifications${buildQuery(params)}`);
}

export function fetchNotifications(
  params: { unreadOnly?: boolean; page?: number; pageSize?: number } = {},
) {
  return listNotifications({
    unread_only: params.unreadOnly || undefined,
    page: params.page,
    page_size: params.pageSize,
  });
}

/** 单条已读（幂等）：返回最新未读数 */
export function readNotification(id: number) {
  return apiFetch<{ unread_count: number }>(`/notifications/${id}/read`, { method: "POST" });
}

/** 单条已读的历史命名别名（= readNotification） */
export function markNotificationRead(id: number) {
  return readNotification(id);
}

/** 全部已读（幂等）：返回最新未读数 */
export function readAllNotifications() {
  return markAllNotificationsRead();
}

export function markAllNotificationsRead() {
  return apiFetch<{ unread_count: number }>("/notifications/read-all", { method: "POST" });
}
