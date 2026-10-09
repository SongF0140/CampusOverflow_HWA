import { ModerationCasesView } from "@/features/admin/ModerationCasesView";

// 审核队列（页面控件级设计说明 §4.4）：登录与管理员守卫由 src/proxy.ts 服务端完成
export default function AdminModerationCasesPage() {
  return <ModerationCasesView />;
}
