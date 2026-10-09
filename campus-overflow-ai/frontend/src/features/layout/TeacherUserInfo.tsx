"use client";

import { useEffect } from "react";

import { UserLine } from "@/shared/components/UserLine";
import { useSessionStore } from "@/shared/stores/session-store";

// 教师端顶栏身份条：Avatar + 姓名 + 教师徽标，点击→ /users/[me.id]（§1.2）
// 登录态来自 session-store，挂载时确保 loadMe 已探测（守卫保证已登录，未就绪时先不渲染）
export function TeacherUserInfo() {
  const me = useSessionStore((state) => state.me);
  const status = useSessionStore((state) => state.status);
  const loadMe = useSessionStore((state) => state.loadMe);

  useEffect(() => {
    void loadMe();
  }, [loadMe]);

  if (status !== "authed" || !me) return null;

  return (
    <UserLine
      userId={me.id}
      nickname={me.username}
      role={me.role}
      avatarSrc={me.avatar_url ?? undefined}
    />
  );
}
