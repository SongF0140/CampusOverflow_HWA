"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { ApiError } from "@/api/client";
import {
  fetchNotifications,
  readAllNotifications,
  readNotification,
} from "@/api/notifications";
import { EmptyState, ErrorState, LoadingSkeleton } from "@/shared/components";
import { NOTIFICATION_TYPE_LABEL } from "@/shared/constants/domain";
import { useNotificationStore } from "@/shared/stores/notification-store";
import type { NotificationItem } from "@/shared/types/notification";
import { formatRelativeTime } from "@/shared/utils/format";

type LoadStatus = "loading" | "ready" | "error";

// 每页 20 条，与后端 page_size 默认值一致
const PAGE_SIZE = 20;

export function NotificationList() {
  const router = useRouter();
  const setUnreadCount = useNotificationStore((state) => state.setUnreadCount);
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [unreadCount, setLocalUnreadCount] = useState(0);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [status, setStatus] = useState<LoadStatus>("loading");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await Promise.resolve();
      if (cancelled) return;
      setStatus("loading");
      try {
        const result = await fetchNotifications({ unreadOnly, page, pageSize: PAGE_SIZE });
        if (cancelled) return;
        setItems(result.items);
        setTotal(result.total);
        setPage(result.page);
        setLocalUnreadCount(result.unread_count);
        setUnreadCount(result.unread_count);
        setStatus("ready");
      } catch {
        if (!cancelled) setStatus("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [unreadOnly, page, reloadToken, setUnreadCount]);

  const reload = useCallback(() => setReloadToken((token) => token + 1), []);

  async function handleOpen(item: NotificationItem) {
    setError(null);
    try {
      if (!item.is_read) {
        const result = await readNotification(item.id);
        setLocalUnreadCount(result.unread_count);
        setUnreadCount(result.unread_count);
      }
      const target = item.link.startsWith("/") ? item.link : "/";
      router.push(target);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "打开通知失败，请稍后重试");
    }
  }

  async function handleReadAll() {
    setPending(true);
    setError(null);
    try {
      const result = await readAllNotifications();
      setLocalUnreadCount(result.unread_count);
      setUnreadCount(result.unread_count);
      reload();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "操作失败，请稍后重试");
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="mx-auto flex max-w-[760px] flex-col gap-4 px-8 py-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-[22px] font-semibold text-ink">
          通知中心
          {unreadCount > 0 ? (
            <span className="ml-2 text-[13px] font-normal text-ink-muted">
              {unreadCount} 条未读
            </span>
          ) : null}
        </h1>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              setUnreadOnly((prev) => !prev);
              setPage(1);
            }}
            aria-pressed={unreadOnly}
            className={`co-focusable cursor-pointer rounded-md border px-3 py-1.5 text-[13px] font-medium transition-colors duration-150 ease-standard ${
              unreadOnly
                ? "border-brand bg-brand-soft text-brand-strong"
                : "border-line bg-canvas text-ink-muted hover:bg-panel"
            }`}
          >
            只看未读
          </button>
          <button
            type="button"
            disabled={pending || unreadCount === 0}
            onClick={() => void handleReadAll()}
            className="co-focusable cursor-pointer rounded-md border border-line bg-canvas px-3 py-1.5 text-[13px] font-medium text-ink transition-colors duration-150 ease-standard hover:bg-panel disabled:cursor-not-allowed disabled:text-ink-subtle"
          >
            全部已读
          </button>
        </div>
      </div>

      {status === "loading" ? <LoadingSkeleton variant="list" count={4} /> : null}
      {status === "error" ? (
        <ErrorState message="通知加载失败，请稍后重试。" onRetry={reload} />
      ) : null}

      {status === "ready" && items.length === 0 ? (
        <EmptyState
          title={unreadOnly ? "没有未读通知" : "还没有通知"}
          description={
            unreadOnly
              ? "取消「只看未读」可以看到历史通知。"
              : "当你的问题被回答、内容被评论或被采纳时，通知会出现在这里。"
          }
          actionLabel={unreadOnly ? "查看全部通知" : "去问题广场"}
          onAction={() => (unreadOnly ? setUnreadOnly(false) : router.push("/"))}
        />
      ) : null}

      {status === "ready" && items.length > 0 ? (
        <>
          <ul className="flex flex-col gap-2">
            {items.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => void handleOpen(item)}
                  className={`co-focusable w-full cursor-pointer rounded-lg border bg-canvas px-4 py-3 text-left transition-colors duration-150 ease-standard hover:border-brand-line ${
                    item.is_read ? "border-line" : "border-brand-line bg-brand-soft/40"
                  }`}
                >
                  <div className="flex flex-wrap items-center gap-2 text-[12px] text-ink-subtle">
                    <span className="rounded-sm bg-panel px-1.5 py-0.5 text-ink-muted">
                      {NOTIFICATION_TYPE_LABEL[item.type] ?? "通知"}
                    </span>
                    <span>{formatRelativeTime(item.created_at)}</span>
                    {!item.is_read ? (
                      <span className="rounded-sm bg-danger-soft px-1.5 py-0.5 font-medium text-danger-ink">
                        未读
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-1.5 text-[14px] text-ink">{item.title}</p>
                </button>
              </li>
            ))}
          </ul>
          <p className="text-[12px] text-ink-subtle">共 {total} 条</p>
          {total > PAGE_SIZE ? (
            <nav className="flex items-center justify-center gap-3" aria-label="分页">
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => setPage((current) => Math.max(1, current - 1))}
                className="co-focusable cursor-pointer rounded-md border border-line bg-canvas px-3 py-1.5 text-[13px] text-ink transition-colors duration-150 ease-standard hover:bg-panel disabled:cursor-not-allowed disabled:text-ink-subtle"
              >
                上一页
              </button>
              <span className="text-[12px] text-ink-muted">
                第 {page} / {pageCount} 页
              </span>
              <button
                type="button"
                disabled={page >= pageCount}
                onClick={() => setPage((current) => Math.min(pageCount, current + 1))}
                className="co-focusable cursor-pointer rounded-md border border-line bg-canvas px-3 py-1.5 text-[13px] text-ink transition-colors duration-150 ease-standard hover:bg-panel disabled:cursor-not-allowed disabled:text-ink-subtle"
              >
                下一页
              </button>
            </nav>
          ) : null}
        </>
      ) : null}

      {error ? (
        <p role="alert" className="rounded-md border border-danger-line bg-danger-soft px-3 py-2 text-[13px] text-danger-ink">
          {error}
        </p>
      ) : null}
    </section>
  );
}
