import type { ReactNode } from "react";

import { AdminSidebar } from "./AdminSidebar";
import { AdminTopbar } from "./AdminTopbar";

// 管理端 Shell（页面控件级设计说明 §1.3）：左侧栏 240px + 顶栏（面包屑 + 管理员身份）+ 内容区
export function AdminShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen bg-panel">
      <AdminSidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <AdminTopbar />
        <main className="mx-auto w-full max-w-[1200px] flex-1 px-6 py-6">{children}</main>
      </div>
    </div>
  );
}
