import { AppealsAdminView } from "@/features/admin/AppealsAdminView";

// 申诉处理（页面控件级设计说明 §4.6）：登录与管理员守卫由 src/proxy.ts 服务端完成
export default function AdminModerationAppealsPage() {
  return <AppealsAdminView />;
}
