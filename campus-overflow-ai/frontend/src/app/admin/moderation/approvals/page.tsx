import { ApprovalCenterView } from "@/features/admin/ApprovalCenterView";

// 审批中心（页面控件级设计说明 §4.5）：登录与管理员守卫由 src/proxy.ts 服务端完成
export default function AdminModerationApprovalsPage() {
  return <ApprovalCenterView />;
}
