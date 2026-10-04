// 通知类型：字段与后端 interaction/schemas.py NotificationItem / NotificationsResponse 一致
// 注意：后端返回的是 title + link（**没有 body**），列表查询参数为蛇形 unread_only
export interface NotificationItem {
  id: number;
  /** 取值见 shared/constants/domain.ts 的 NOTIFICATION_TYPE（后端为字符串） */
  type: string;
  title: string;
  /** 点击后跳转的相对地址，如 /questions/4#answer-1 */
  link: string;
  is_read: boolean;
  created_at: string;
}

export interface NotificationListResult {
  items: NotificationItem[];
  total: number;
  unread_count: number;
  page: number;
  page_size: number;
}
