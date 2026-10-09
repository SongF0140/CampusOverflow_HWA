import Link from "next/link";

import { Avatar } from "./Avatar";

export type UserRole = "student" | "teacher" | "admin";

// 角色中文徽标：一律"色块 + 文字"（设计系统 §3.3）
const ROLE_BADGE: Record<UserRole, { label: string; className: string }> = {
  student: { label: "学生", className: "bg-panel text-ink-muted" },
  teacher: { label: "教师", className: "bg-brand-soft text-brand-strong" },
  admin: { label: "管理员", className: "bg-danger-soft text-danger-ink" },
};

const BADGE_BASE = "inline-flex items-center rounded-sm px-1.5 py-0.5 text-[11px] font-medium";

// 用户信息行：头像 + 昵称 + 角色徽标，整行链接到用户主页
// 公开信息不含邮箱，本组件不接收也不展示任何邮箱字段
export function UserLine({
  userId,
  nickname,
  role,
  avatarSrc,
  graduateAssistant = false,
  size = "md",
  className = "",
}: {
  userId: number | string;
  nickname: string;
  role: UserRole;
  avatarSrc?: string;
  graduateAssistant?: boolean;
  size?: "sm" | "md";
  className?: string;
}) {
  const roleBadge = ROLE_BADGE[role];
  return (
    <Link
      href={`/users/${userId}`}
      className={`co-focusable inline-flex w-fit items-center gap-2 rounded-sm ${className}`}
    >
      <Avatar name={nickname} src={avatarSrc} size={size} />
      <span className={`font-medium text-ink ${size === "sm" ? "text-[13px]" : "text-[14px]"}`}>
        {nickname}
      </span>
      <span className={`${BADGE_BASE} ${roleBadge.className}`}>{roleBadge.label}</span>
      {graduateAssistant ? (
        <span className={`${BADGE_BASE} bg-success-soft text-success-ink`}>助教</span>
      ) : null}
    </Link>
  );
}
