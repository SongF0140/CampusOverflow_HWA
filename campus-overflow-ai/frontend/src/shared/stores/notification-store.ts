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

// 过期请求保护：每次权威写入（load 的成功/失败、setUnreadCount）都递增版本号。
// load 在发请求前记下版本号，返回时若已变化，说明期间有更新的结果（如"标记已读"），
// 丢弃本次响应——否则顶栏挂载时的查询晚于已读操作返回，会把徽标覆盖回旧计数。
let revision = 0;

export const useNotificationStore = create<NotificationState>((set) => ({
  unreadCount: 0,
  load: async () => {
    const startedAt = revision;
    try {
      const result = await fetchNotifications({ pageSize: 1 });
      if (revision !== startedAt) return;
      revision += 1;
      set({ unreadCount: result.unread_count });
    } catch {
      if (revision !== startedAt) return;
      revision += 1;
      // 拉取失败不阻塞页面：铃铛不显示徽标
      set({ unreadCount: 0 });
    }
  },
  setUnreadCount: (unreadCount) => {
    revision += 1;
    set({ unreadCount });
  },
}));
