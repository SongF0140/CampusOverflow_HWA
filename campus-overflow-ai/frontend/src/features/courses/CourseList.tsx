"use client";

import { useEffect, useState } from "react";

import { fetchCourses } from "@/api/courses";
import { EmptyState, ErrorState, LoadingSkeleton } from "@/shared/components";
import type { CourseListItem } from "@/shared/types/course";

import { CourseCard } from "./CourseCard";

type LoadStatus = "loading" | "ready" | "error";

// 每页 20 门，与后端 page_size 默认值一致
const PAGE_SIZE = 20;

export function CourseList({
  initialKeyword = "",
  initialPage = 1,
}: {
  initialKeyword?: string;
  initialPage?: number;
}) {
  const [keyword, setKeyword] = useState(initialKeyword);
  const [page, setPage] = useState(initialPage);
  const [items, setItems] = useState<CourseListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [status, setStatus] = useState<LoadStatus>("loading");
  const [reloadToken, setReloadToken] = useState(0);
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      // 先让出一次微任务：避免在 effect 中同步 setState（react-hooks/set-state-in-effect）
      await Promise.resolve();
      if (cancelled) return;
      setStatus("loading");
      try {
        const result = await fetchCourses({ keyword, page, page_size: PAGE_SIZE });
        if (cancelled) return;
        setItems(result.items);
        setTotal(result.total);
        setStatus("ready");
      } catch {
        if (!cancelled) setStatus("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [keyword, page, reloadToken]);

  // 搜索与页码写进 URL，便于返回与分享（参数名与真接口一致）
  useEffect(() => {
    const params = new URLSearchParams();
    if (keyword.trim()) params.set("keyword", keyword.trim());
    if (page > 1) params.set("page", String(page));
    const query = params.toString();
    window.history.replaceState(null, "", query ? `/courses?${query}` : "/courses");
  }, [keyword, page]);

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-[22px] font-semibold text-ink">课程列表</h1>
        <input
          value={keyword}
          onChange={(event) => {
            setKeyword(event.target.value);
            setPage(1);
          }}
          placeholder="搜索课程名或编码"
          aria-label="搜索课程名或编码"
          className="co-focusable h-9 w-[240px] rounded-md border border-line bg-canvas px-3 text-[13px] text-ink transition-colors duration-150 ease-standard placeholder:text-ink-subtle hover:border-ink-subtle focus:border-brand focus:ring-2 focus:ring-brand/20"
        />
      </div>

      {status === "loading" ? <LoadingSkeleton variant="list" count={4} /> : null}

      {status === "error" ? (
        <ErrorState
          message="课程列表加载失败，请检查网络后重试。"
          onRetry={() => setReloadToken((token) => token + 1)}
        />
      ) : null}

      {status === "ready" && items.length === 0 ? (
        <EmptyState
          title="没有找到符合条件的课程"
          description="换个关键词再试一次，或查看全部课程。"
          actionLabel="清除筛选"
          onAction={() => {
            setKeyword("");
            setPage(1);
          }}
        />
      ) : null}

      {status === "ready" && items.length > 0 ? (
        <>
          <ul className="flex flex-col gap-3">
            {items.map((course) => (
              <li key={course.id}>
                <CourseCard course={course} />
              </li>
            ))}
          </ul>
          <p className="text-[12px] text-ink-subtle">共 {total} 门课程</p>
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
    </section>
  );
}
