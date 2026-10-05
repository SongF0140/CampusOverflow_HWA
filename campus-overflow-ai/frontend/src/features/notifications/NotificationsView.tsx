"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import {
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from "@/api/notifications";
import { timeAgo } from "@/features/questions/timeAgo";
import {
  Button,
  EmptyState,
  ErrorState,
  LoadingSkeleton,
  Pagination,
  Toast,
  type ToastTone,
} from "@/shared/components";
import { toErrorMessage, useAsyncData } from "@/shared/hooks/useAsyncData";
import type { Notification } from "@/shared/types/notification";

const PAGE_SIZE = 10;

type NotificationTab = "all" | "unread";

interface ToastState {
  tone: ToastTone;
  message: string;
}

// 通知类型 → 图标/标签（§2.14）：💬 被回答 / ✓ 被采纳 / ⚖ 审核结果 / 🔔 系统。
// 后端当前产出 answered/commented/accepted；moderation 留给二期治理，未知类型回退系统
const TYPE_META: Record<string, { icon: string; label: string }> = {
  answered: { icon: "💬", label: "被回答" },
  commented: { icon: "💬", label: "被评论" },
  accepted: { icon: "✓", label: "被采纳" },
  moderation: { icon: "⚖", label: "审核结果" },
};

const SYSTEM_META = { icon: "🔔", label: "系统" };

const TAB_BASE =
  "co-focusable relative h-10 cursor-pointer px-3 text-[14px] font-medium transition-colors duration-150 ease-standard";

// 通知中心（P-S12 / §2.14）：全部/未读 Tab（未读红字）+ 行点击已读跳转 + 全部已读 + 分页
export function NotificationsView() {
  const router = useRouter();

  const [tab, setTab] = useState<NotificationTab>("all");
  const [page, setPage] = useState(1);
  // 已读动作回包的最新未读数（后端 read/read-all 均返回），优先于列表响应
  const [unreadOverride, setUnreadOverride] = useState<number | null>(null);
  const [toast, setToast] = useState<ToastState | null>(null);

  const { data, isLoading, error, reload } = useAsyncData(
    () =>
      listNotifications({
        unread_only: tab === "unread",
        page,
        page_size: PAGE_SIZE,
      }),
    [tab, page],
  );

  // Toast 自动消失：倒计时回调里 setState，不在 effect 同步路径上
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 3000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  // unread_count 恒为本人全部未读数（接口文档 §8），不受 Tab 与分页影响
  const unreadCount = unreadOverride ?? data?.unread_count ?? 0;

  function handleTabChange(next: NotificationTab) {
    if (next === tab) return;
    setTab(next);
    setPage(1);
    setUnreadOverride(null);
  }

  function handlePageChange(next: number) {
    setPage(next);
    setUnreadOverride(null);
  }

  async function handleItemClick(item: Notification) {
    if (!item.is_read) {
      try {
        const result = await markNotificationRead(item.id);
        setUnreadOverride(result.unread_count);
      } catch {
        // 已读失败不阻塞跳转：来源页仍可达
      }
    }
    // 后端 link 为站内路径（如 /questions/9#answer-4）；空则仅标记已读不跳转
    if (item.link) router.push(item.link);
  }

  async function handleReadAll() {
    try {
      const result = await markAllNotificationsRead();
      setUnreadOverride(result.unread_count);
      reload();
    } catch (caught) {
      setToast({ tone: "error", message: toErrorMessage(caught) });
    }
  }

  const items = data?.items ?? [];

  return (
    <div className="flex flex-col gap-4">
      {toast ? (
        <div className="fixed left-1/2 top-20 z-50 w-[min(90vw,360px)] -translate-x-1/2">
          <Toast tone={toast.tone} message={toast.message} onClose={() => setToast(null)} />
        </div>
      ) : null}

      <h1 className="text-[22px] font-semibold text-ink">通知中心</h1>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div role="tablist" aria-label="通知筛选" className="flex items-end gap-1 border-b border-line">
          <button
            type="button"
            role="tab"
            aria-selected={tab === "all"}
            onClick={() => handleTabChange("all")}
            className={`${TAB_BASE} ${tab === "all" ? "text-brand" : "text-ink-muted hover:text-ink"}`}
          >
            全部
            {tab === "all" ? (
              <span
                aria-hidden="true"
                className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-brand"
              />
            ) : null}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "unread"}
            onClick={() => handleTabChange("unread")}
            className={`${TAB_BASE} ${tab === "unread" ? "text-brand" : "text-ink-muted hover:text-ink"}`}
          >
            未读
            {unreadCount > 0 ? (
              <span aria-label={`${unreadCount} 条未读`} className="ml-1 text-[12px] font-semibold text-danger">
                {unreadCount}
              </span>
            ) : null}
            {tab === "unread" ? (
              <span
                aria-hidden="true"
                className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-brand"
              />
            ) : null}
          </button>
        </div>

        <Button
          variant="ghost"
          onClick={() => void handleReadAll()}
          disabled={unreadCount === 0}
        >
          全部已读
        </Button>
      </div>

      {isLoading ? (
        <LoadingSkeleton variant="list" count={5} />
      ) : error !== null ? (
        <ErrorState message={error} onRetry={reload} />
      ) : items.length === 0 ? (
        <EmptyState
          title={tab === "unread" ? "没有未读通知" : "暂无通知"}
          description={
            tab === "unread"
              ? "有新回答、采纳或审核结果时会第一时间在这里提醒你。"
              : undefined
          }
        />
      ) : (
        <>
          <ul className="flex flex-col divide-y divide-line rounded-lg border border-line bg-canvas">
            {items.map((item) => {
              const meta = TYPE_META[item.type] ?? SYSTEM_META;
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => void handleItemClick(item)}
                    className="co-focusable flex min-h-16 w-full cursor-pointer items-center gap-3 px-4 py-3 text-left transition-colors duration-150 ease-standard hover:bg-panel"
                  >
                    <span
                      aria-hidden="true"
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-panel text-[16px]"
                    >
                      {meta.icon}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span
                        className={`block truncate text-[14px] ${
                          item.is_read ? "text-ink-muted" : "font-medium text-ink"
                        }`}
                      >
                        {item.title}
                      </span>
                      <span className="mt-0.5 block text-[12px] text-ink-subtle">
                        {meta.label} · {timeAgo(item.created_at)}
                      </span>
                    </span>
                    {item.is_read ? null : (
                      <span aria-label="未读" className="h-2 w-2 shrink-0 rounded-full bg-brand" />
                    )}
                  </button>
                </li>
              );
            })}
          </ul>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-[12px] text-ink-subtle">共 {data?.total ?? 0} 条</p>
            <Pagination
              page={page}
              pageSize={PAGE_SIZE}
              total={data?.total ?? 0}
              onChange={handlePageChange}
            />
          </div>
        </>
      )}
    </div>
  );
}
