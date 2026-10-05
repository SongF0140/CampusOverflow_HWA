"use client";

import { useEffect } from "react";

import { EmptyState } from "@/shared/components";
import { useSessionStore } from "@/shared/stores/session-store";
import { redirectToLogin } from "@/shared/utils/navigation";

import { ProfileCard } from "./ProfileCard";
import { ReputationLedger } from "./ReputationLedger";

// 个人中心（页面控件级设计说明 §2.12）：左 5 列资料卡 + 右 7 列声望流水
// 登录已由 middleware 守卫（guard.ts PROTECTED_PREFIXES 含 /me）；guest 态兜底登录引导
export function MePanel() {
  const me = useSessionStore((state) => state.me);
  const status = useSessionStore((state) => state.status);
  const loadMe = useSessionStore((state) => state.loadMe);

  // 与 TopNav 同款：挂载即探测登录态，同页导航回 /me 时保证 me 就绪
  useEffect(() => {
    void loadMe();
  }, [loadMe]);

  if (status === "guest") {
    return (
      <EmptyState
        title="登录后查看个人中心"
        description="资料编辑与声望流水仅本人可见，请先登录。"
        actionLabel="去登录"
        onAction={() => redirectToLogin()}
      />
    );
  }

  if (me === null) {
    return (
      <div className="flex flex-col gap-4" role="status" aria-live="polite">
        <span className="sr-only">正在加载个人中心</span>
        <div className="co-skeleton h-7 w-28 rounded-sm" />
        <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-12">
          <div className="co-skeleton h-72 rounded-lg lg:col-span-5" />
          <div className="co-skeleton h-72 rounded-lg lg:col-span-7" />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <h1 className="text-[22px] font-semibold text-ink">个人中心</h1>
      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-12">
        <div className="lg:col-span-5">
          <ProfileCard me={me} />
        </div>
        <div className="lg:col-span-7">
          <ReputationLedger />
        </div>
      </div>
    </div>
  );
}
