import { NotificationsView } from "@/features/notifications/NotificationsView";

// 通知中心（P-S12 / §2.14）：middleware 已守卫登录；Server 壳不取数，交互与数据在 NotificationsView（client）
export default function NotificationsPage() {
  return (
    <main className="mx-auto w-full max-w-[1200px] px-4 py-6 sm:px-8">
      <NotificationsView />
    </main>
  );
}
