"use client";

import { useRouter } from "next/navigation";

import { getUser, getUserReputation } from "@/api/users";
import {
  Avatar,
  EmptyState,
  ErrorState,
  LoadingSkeleton,
  TabNav,
} from "@/shared/components";
import { useAsyncData } from "@/shared/hooks/useAsyncData";
import type { UserRole } from "@/shared/types/auth";
import { ProfileContent } from "./ProfileContent";

export type ProfileTab = "questions" | "answers" | "hot";

const PROFILE_TABS: { key: ProfileTab; label: string }[] = [
  { key: "questions", label: "TA 的提问" },
  { key: "answers", label: "TA 的回答" },
  { key: "hot", label: "热门" },
];

function isProfileTab(value: string): value is ProfileTab {
  return value === "questions" || value === "answers" || value === "hot";
}

// 角色中文徽标（与 UserLine 的角色徽标同款样式；头卡非链接场景单独渲染）
const ROLE_BADGE: Record<UserRole, { label: string; className: string }> = {
  student: { label: "学生", className: "bg-panel text-ink-muted" },
  teacher: { label: "教师", className: "bg-brand-soft text-brand-strong" },
  admin: { label: "管理员", className: "bg-danger-soft text-danger-ink" },
};

// "加入于 YYYY-MM"：直接截取 ISO 日期前 7 位，避免时区换算导致月份漂移
export function formatJoinedMonth(iso: string): string {
  return /^\d{4}-\d{2}/.test(iso) ? iso.slice(0, 7) : "—";
}

// 用户或页签变化时重挂载内容列表，分页从第一页开始。
function ProfileTabContent({ tab, userId }: { tab: ProfileTab; userId: number }) {
  if (tab !== "hot") return <ProfileContent key={`${userId}-${tab}`} userId={userId} tab={tab} />;
  return (
    <EmptyState
      title="热门内容即将开放"
      description="按用户查看热门内容的接口尚未开放，敬请期待。"
    />
  );
}

// 用户公开主页（§2.11）：头卡（大头像/昵称/角色徽标/加入时间/声望摘要）+ 页内 Tab
// 公开接口不含邮箱/手机号，本组件不渲染任何联系方式字段
export function UserProfileView({ userId, initialTab }: { userId: number; initialTab: ProfileTab }) {
  const router = useRouter();
  const userState = useAsyncData(() => getUser(userId), [userId]);
  // 公开声誉失败不阻塞头卡：声望回退到 UserPublic.reputation_score
  const reputationState = useAsyncData(() => getUserReputation(userId), [userId]);

  // Tab 写 URL（?tab= 仅 answers/hot 出现，默认 questions 不写入），
  // server 壳解析后经 props 回传，浏览器回退/前进同路径生效
  function handleTabChange(key: string) {
    if (!isProfileTab(key) || key === initialTab) return;
    router.replace(key === "questions" ? `/users/${userId}` : `/users/${userId}?tab=${key}`);
  }

  if (userState.isLoading) {
    return (
      <div className="flex flex-col gap-4" role="status" aria-live="polite">
        <span className="sr-only">正在加载用户主页</span>
        <div className="co-skeleton h-28 rounded-lg" />
        <LoadingSkeleton variant="list" count={3} />
      </div>
    );
  }

  if (userState.error !== null) {
    return <ErrorState message={userState.error} onRetry={userState.reload} />;
  }

  const user = userState.data;
  if (user === null) {
    return <ErrorState onRetry={userState.reload} />;
  }

  const reputation = reputationState.data;
  const roleBadge = ROLE_BADGE[user.role];

  return (
    <div className="flex flex-col gap-5">
      {/* 头卡：大头像 64px + 昵称 + 角色徽标 + 加入时间 + 声望摘要块（§2.11） */}
      <section className="rounded-lg border border-line bg-canvas p-6">
        <div className="flex flex-wrap items-center gap-4">
          <Avatar name={user.username} src={user.avatar_url ?? undefined} size="lg" />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-[22px] font-semibold text-ink">{user.username}</h1>
              <span
                className={`inline-flex items-center rounded-sm px-1.5 py-0.5 text-[11px] font-medium ${roleBadge.className}`}
              >
                {roleBadge.label}
              </span>
            </div>
            <p className="mt-1 text-[13px] text-ink-muted">
              加入于 {formatJoinedMonth(user.created_at)}
            </p>
            {user.bio ? (
              <p className="mt-2 max-w-[60ch] text-[13px] leading-relaxed text-ink-muted">
                {user.bio}
              </p>
            ) : null}
          </div>

          {/* 声望摘要块：周变动/采纳率后端暂无字段，占位展示（红↑绿↓随接口补充） */}
          <div className="ml-auto flex gap-6 text-center">
            <div className="flex flex-col">
              <span className="text-[20px] font-semibold text-ink">
                {reputation?.reputation_score ?? user.reputation_score}
              </span>
              <span className="text-[12px] text-ink-subtle">当前声望</span>
            </div>
            <div className="flex flex-col">
              {/* TODO(接口差异)：后端 PublicReputationResponse 无周变动字段，随接口补充回填 */}
              <span className="text-[20px] font-semibold text-ink-subtle">—</span>
              <span className="text-[12px] text-ink-subtle">周变动</span>
            </div>
            <div className="flex flex-col">
              {/* TODO(接口差异)：后端无按用户聚合的采纳数/采纳率字段，随接口补充回填 */}
              <span className="text-[20px] font-semibold text-ink-subtle">—</span>
              <span className="text-[12px] text-ink-subtle">采纳率</span>
            </div>
          </div>
        </div>

        {reputation ? (
          <p className="mt-3 text-[12px] text-ink-subtle">
            提问 {reputation.question_count} · 回答 {reputation.answer_count}
          </p>
        ) : null}
      </section>

      {/* TODO(AI 二期)：用户画像/相似用户推荐槽位，随 Agent 服务开放 */}
      <div>
        <TabNav tabs={PROFILE_TABS} active={initialTab} onChange={handleTabChange} />
        <div className="pt-4">
          <ProfileTabContent tab={initialTab} userId={userId} />
        </div>
      </div>
    </div>
  );
}
