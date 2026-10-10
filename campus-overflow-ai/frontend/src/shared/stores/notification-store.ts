"use client";

import { create } from "zustand";

import { fetchNotifications } from "@/api/notifications";

/**
 * 未读数全局态：顶栏铃铛与通知中心共用同一份数字，避免两处各拉一次接口。
 * 值来源：GET /api/notifications 的 unread_count（只取 1 条即可拿到未读总数）。
 */
interface NotificationState {
  unreadCount: number;
  load: () => Promise<void>;
  setUnreadCount: (value: number) => void;
}

export const useNotificationStore = create<NotificationState>((set) => ({
  unreadCount: 0,
  load: async () => {
    try {
      const result = await fetchNotifications({ pageSize: 1 });
      set({ unreadCount: result.unread_count });
    } catch {
      // 拉取失败不阻塞页面：铃铛不显示徽标
      set({ unreadCount: 0 });
    }
  },
  setUnreadCount: (unreadCount) => set({ unreadCount }),
}));
