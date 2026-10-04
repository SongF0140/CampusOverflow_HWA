"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { fetchPublicReputation, fetchPublicUser } from "@/api/users";
import { ErrorState, LoadingSkeleton } from "@/shared/components";
import { USER_ROLE_LABEL, USER_STATUS } from "@/shared/constants/domain";
import type { PublicReputation, PublicUser } from "@/shared/types/user";

type LoadStatus = "loading" | "ready" | "error";

export function PublicProfileView({ userId }: { userId: number }) {
  const [profile, setProfile] = useState<PublicUser | null>(null);
  const [reputation, setReputation] = useState<PublicReputation | null>(null);
  const [status, setStatus] = useState<LoadStatus>("loading");
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await Promise.resolve();
      if (cancelled) return;
      setStatus("loading");
      try {
        const [user, rep] = await Promise.all([
          fetchPublicUser(userId),
          fetchPublicReputation(userId),
        ]);
        if (cancelled) return;
        setProfile(user);
        setReputation(rep);
        setStatus("ready");
      } catch {
        if (!cancelled) setStatus("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId, reloadToken]);

  if (status === "loading") {
    return (
      <div className="mx-auto max-w-[760px] px-8 py-6">
        <LoadingSkeleton variant="detail" count={2} />
      </div>
    );
  }

  if (status === "error" || !profile) {
    return (
      <div className="mx-auto max-w-[760px] px-8 py-6">
        <ErrorState
          message="用户信息加载失败，可能不存在。"
          onRetry={() => setReloadToken((token) => token + 1)}
        />
      </div>
    );
  }

  return (
    <section className="mx-auto flex max-w-[760px] flex-col gap-4 px-8 py-6">
      <nav aria-label="面包屑" className="flex items-center gap-2 text-[12px] text-ink-subtle">
        <Link href="/" className="co-focusable text-ink-muted hover:text-brand">
          问题广场
        </Link>
        <span aria-hidden="true">/</span>
        <span>用户主页</span>
      </nav>

      <div className="rounded-lg border border-line bg-canvas p-6">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-[22px] font-semibold text-ink">{profile.username}</h1>
          <span className="rounded-sm bg-panel px-2 py-0.5 text-[12px] text-ink-muted">
            {USER_ROLE_LABEL[profile.role] ?? "用户"}
          </span>
          {profile.status === USER_STATUS.banned ? (
            <span className="rounded-sm bg-danger-soft px-2 py-0.5 text-[12px] font-medium text-danger-ink">
              已封禁
            </span>
          ) : null}
        </div>

        <dl className="mt-4 grid grid-cols-3 gap-3">
          <div className="rounded-md border border-line bg-panel px-4 py-3">
            <dt className="text-[12px] text-ink-muted">声誉</dt>
            <dd className="mt-1 text-[18px] font-semibold text-ink">
              {reputation?.reputation_score ?? profile.reputation_score}
            </dd>
          </div>
          <div className="rounded-md border border-line bg-panel px-4 py-3">
            <dt className="text-[12px] text-ink-muted">提问</dt>
            <dd className="mt-1 text-[18px] font-semibold text-ink">
              {reputation?.question_count ?? 0}
            </dd>
          </div>
          <div className="rounded-md border border-line bg-panel px-4 py-3">
            <dt className="text-[12px] text-ink-muted">回答</dt>
            <dd className="mt-1 text-[18px] font-semibold text-ink">
              {reputation?.answer_count ?? 0}
            </dd>
          </div>
        </dl>

        <div className="mt-4">
          <h2 className="text-[13px] font-medium text-ink">个人简介</h2>
          <p className="mt-1 whitespace-pre-wrap text-[14px] leading-relaxed text-ink-muted">
            {profile.bio?.trim() ? profile.bio : "这位同学还没有填写简介。"}
          </p>
        </div>

        <p className="mt-4 text-[12px] text-ink-subtle">
          加入时间：{new Date(profile.created_at).toLocaleDateString("zh-CN")}
        </p>

        {/* 公开信息不含邮箱等隐私字段（UserPublicResponse 本身就不返回），前端也不展示 */}
        {/* TODO(需后端补接口): 该用户的提问/回答列表需要 GET /api/users/{id}/questions|answers，暂缺 */}
      </div>
    </section>
  );
}
