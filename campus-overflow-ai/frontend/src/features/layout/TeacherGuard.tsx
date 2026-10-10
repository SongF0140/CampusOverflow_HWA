"use client";

import { useEffect } from "react";

import { ForbiddenNotice, LoadingSkeleton } from "@/shared/components";
import { USER_ROLE } from "@/shared/constants/domain";
import { useSessionStore } from "@/shared/stores/session-store";
import { isGraduateAssistant } from "@/shared/utils/assistant";

/**
 * 教师端页面级角色守卫（页面控件级设计说明 §1.2 + §3.6）：
 * /teacher/** 仅「教师 / 管理员 / 已认证研究生助教」可进。
 * 边缘守卫（src/proxy.ts）只能读 JWT 的 role，无法区分「学生」与「研究生助教」，
 * 因此这一层补上；其他角色展示无权限页，且**不渲染子页面**（因此不会发出任何请求）。
 */
export function TeacherGuard({ children }: { children: React.ReactNode }) {
  const me = useSessionStore((state) => state.me);
  const status = useSessionStore((state) => state.status);
  const loadMe = useSessionStore((state) => state.loadMe);

  useEffect(() => {
    void loadMe();
  }, [loadMe]);

  if (status === "loading") {
    return (
      <div className="mx-auto w-full max-w-[1200px] px-6 py-10">
        <LoadingSkeleton variant="detail" count={3} />
      </div>
    );
  }

  const allowed =
    !!me &&
    (me.role === USER_ROLE.teacher || me.role === USER_ROLE.admin || isGraduateAssistant(me));

  if (!allowed) return <ForbiddenNotice />;

  return <>{children}</>;
}
