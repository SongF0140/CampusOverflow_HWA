import { AdminAgentRunsView } from "@/features/admin/AdminAgentRunsView";

export const metadata = { title: "Agent 运行记录 · CampusOverflow" };

// 运行记录列表（页面控件级设计说明 §4.7）：登录与管理员守卫由 src/proxy.ts 完成
export default function AdminAgentRunsPage() {
  return <AdminAgentRunsView />;
}
