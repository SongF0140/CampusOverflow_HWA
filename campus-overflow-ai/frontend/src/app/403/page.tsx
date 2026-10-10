import { ForbiddenNotice } from "@/shared/components";

export const metadata = { title: "无访问权限 · CampusOverflow" };

// 无权限页：纯静态展示，不发任何业务请求（页面控件级设计说明 §1.3）
export default function ForbiddenPage() {
  return <ForbiddenNotice />;
}
