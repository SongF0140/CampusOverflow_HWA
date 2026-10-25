import { Suspense } from "react";

import { ApprovalCenterView } from "@/features/admin/ApprovalCenterView";
import { LoadingSkeleton } from "@/shared/components";

// 审批中心（页面控件级设计说明 §4.5）：登录与管理员守卫由 src/proxy.ts 服务端完成
// ?case_id= 定位经 useSearchParams 读取，需要 Suspense 边界，静态预渲染时回退骨架
export default function AdminModerationApprovalsPage() {
  return (
    <Suspense fallback={<LoadingSkeleton variant="detail" count={3} />}>
      <ApprovalCenterView />
    </Suspense>
  );
}
