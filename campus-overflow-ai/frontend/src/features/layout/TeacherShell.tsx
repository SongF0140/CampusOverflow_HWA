import Link from "next/link";
import type { ReactNode } from "react";

import { TeacherUserInfo } from "./TeacherUserInfo";

// 教师端 Shell（页面控件级设计说明 §1.2）：顶栏 + 内容区，无左侧栏（页内 Tab 承载）
export function TeacherShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-panel">
      <header className="sticky top-0 z-40 border-b border-line bg-canvas">
        <div className="mx-auto flex h-16 w-full max-w-[1200px] items-center justify-between gap-4 px-6">
          <div className="flex min-w-0 items-center gap-3">
            <Link
              href="/"
              className="co-focusable shrink-0 rounded-md px-2 py-1.5 text-[13px] text-ink-muted transition-colors duration-150 ease-standard hover:bg-panel hover:text-ink"
            >
              ← 返回学生端
            </Link>
            <span aria-hidden="true" className="h-4 w-px shrink-0 bg-line" />
            <h1 className="truncate text-[15px] font-semibold text-ink">教师端</h1>
          </div>
          <TeacherUserInfo />
        </div>
      </header>
      <main className="mx-auto w-full max-w-[1200px] flex-1 px-6 py-6">{children}</main>
    </div>
  );
}
