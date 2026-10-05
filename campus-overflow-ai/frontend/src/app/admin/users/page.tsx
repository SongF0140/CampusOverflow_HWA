import { AdminUsersView } from "@/features/admin/AdminUsersView";

// 用户管理（页面控件级设计说明 §4.2）：登录与管理员守卫由 src/proxy.ts 服务端完成
export default function AdminUsersPage() {
  return <AdminUsersView />;
}
