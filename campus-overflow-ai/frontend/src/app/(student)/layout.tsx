import type { ReactNode } from "react";

import { TopNav } from "@/features/layout/TopNav";

// 学生端共享布局（route group 不改变 URL）：顶栏在学生端所有页面显示
// /teacher、/admin、/auth、/api 不在本组内，各自使用独立布局
export default function StudentLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-panel">
      <TopNav />
      <div className="flex-1">{children}</div>
    </div>
  );
}
