import type { ReactNode } from "react";

import { AdminShell } from "@/features/layout/AdminShell";

// 管理端路由守卫（登录 + admin 角色）由 src/proxy.ts 在服务端完成；此处只负责布局
export default function AdminLayout({ children }: { children: ReactNode }) {
  return <AdminShell>{children}</AdminShell>;
}
