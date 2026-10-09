import { AdminOverviewView } from "@/features/admin/AdminOverviewView";

// 治理总览（页面控件级设计说明 §4.1）：登录与管理员守卫由 src/proxy.ts 服务端完成
export default function AdminPage() {
  return <AdminOverviewView />;
}
