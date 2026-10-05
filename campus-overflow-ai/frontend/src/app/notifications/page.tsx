import { TopNav } from "@/features/layout/TopNav";
import { NotificationList } from "@/features/notifications/NotificationList";

export const metadata = { title: "通知中心 · CampusOverflow" };

// 学生端页面统一形态：顶栏 + 内容区（列表组件自带 760px 内容宽度）
export default function NotificationsPage() {
  return (
    <div className="min-h-screen bg-panel">
      <TopNav />
      <main>
        <NotificationList />
      </main>
    </div>
  );
}
