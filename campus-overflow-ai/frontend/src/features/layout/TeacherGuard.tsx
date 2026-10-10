"use client";

import { useEffect } from "react";

import { ForbiddenNotice, LoadingSkeleton } from "@/shared/components";
import { USER_ROLE } from "@/shared/constants/domain";
import { useSessionStore } from "@/shared/stores/session-store";

/**
 * 教师端页面级角色守卫（页面控件级设计说明 §1.2 + §3.6）：/teacher/** 仅「教师 / 管理员」可进。
 * 研究生助教**不放行**：它不是教师角色，而是学生角色上的附加能力位
 * （US-20 / E-12 / Q-07），能力范围是学生端回答问题 + 标记推荐回答；
 * 放行整个 /teacher/** 会越出能力边界。其他角色展示无权限页，
 * 且**不渲染子页面**（因此不会发出任何请求）。
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

  const allowed = !!me && (me.role === USER_ROLE.teacher || me.role === USER_ROLE.admin);

  if (!allowed) return <ForbiddenNotice />;

  return <>{children}</>;
}
