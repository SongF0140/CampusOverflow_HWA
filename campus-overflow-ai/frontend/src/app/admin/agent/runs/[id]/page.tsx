import { AdminAgentRunTraceView } from "@/features/admin/AdminAgentRunTraceView";

export const metadata = { title: "运行调用链 · CampusOverflow" };

// 运行调用链详情（页面控件级设计说明 §4.7）：登录与管理员守卫由 src/proxy.ts 完成
export default async function AdminAgentRunTracePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return <AdminAgentRunTraceView agentRunId={decodeURIComponent(id)} />;
}
