"use client";

import { useEffect, useState } from "react";

import { fetchQuestionList } from "@/api/questions";
import { EmptyState, ErrorState, LoadingSkeleton } from "@/shared/components";
import type { QuestionListItem, QuestionSort } from "@/shared/types/question";

import { QuestionCard } from "./QuestionCard";

type LoadStatus = "loading" | "ready" | "error";

// 每页 20 条，与后端 page_size 默认值一致
const PAGE_SIZE = 20;

export function QuestionList({
  initialKeyword = "",
  initialSort = "latest",
  initialUnresolved = false,
  initialPage = 1,
  courseId,
  tagId,
  title = "问题广场",
  basePath = "/",
  headingLevel = "h1",
}: {
  initialKeyword?: string;
  initialSort?: QuestionSort;
  initialUnresolved?: boolean;
  /** URL ?page= 由服务端解析后回填（课程/标签详情页用） */
  initialPage?: number;
  courseId?: number;
  tagId?: number;
  title?: string;
  basePath?: string;
  headingLevel?: "h1" | "h2";
}) {
  const [keyword, setKeyword] = useState(initialKeyword);
  const [sort, setSort] = useState<QuestionSort>(initialSort);
  const [unresolvedOnly, setUnresolvedOnly] = useState(initialUnresolved);
  const [items, setItems] = useState<QuestionListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [status, setStatus] = useState<LoadStatus>("loading");
  const [reloadToken, setReloadToken] = useState(0);
  const [page, setPage] = useState(initialPage);
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const Heading = headingLevel;

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      // 先让出一次微任务：避免在 effect 中同步 setState（react-hooks/set-state-in-effect）
      await Promise.resolve();
      if (cancelled) return;
      setStatus("loading");
      try {
        const result = await fetchQuestionList({
          keyword,
          sort,
          unresolved: unresolvedOnly,
          course_id: courseId,
          tag_id: tagId,
          page,
          page_size: PAGE_SIZE,
        });
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
  }, [keyword, sort, unresolvedOnly, courseId, tagId, page, reloadToken]);

  // 筛选条件写进 URL，便于回填与分享（参数名与真接口一致）；
  // 同一页面上的其它参数（如教师端课程管理的 tab）要保留，不能被覆盖掉
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    for (const key of ["keyword", "sort", "unresolved"]) params.delete(key);
    if (keyword.trim()) params.set("keyword", keyword.trim());
    if (sort === "hot") params.set("sort", "hot");
    if (unresolvedOnly) params.set("unresolved", "1");
    const query = params.toString();
    window.history.replaceState(null, "", query ? `${basePath}?${query}` : basePath);
  }, [basePath, keyword, sort, unresolvedOnly]);

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Heading className="text-[22px] font-semibold text-ink">{title}</Heading>
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={keyword}
            onChange={(event) => {
              setKeyword(event.target.value);
              setPage(1);
            }}
            placeholder="搜索问题标题"
            aria-label="搜索问题标题"
            className="co-focusable h-9 w-[220px] rounded-md border border-line bg-canvas px-3 text-[13px] text-ink transition-colors duration-150 ease-standard placeholder:text-ink-subtle hover:border-ink-subtle focus:border-brand focus:ring-2 focus:ring-brand/20"
          />
          <div className="flex items-center gap-1 rounded-md border border-line bg-canvas p-0.5">
            {(["latest", "hot"] as QuestionSort[]).map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => {
                  setSort(value);
                  setPage(1);
                }}
                aria-pressed={sort === value}
                className={`co-focusable cursor-pointer rounded-sm px-3 py-1.5 text-[13px] font-medium transition-colors duration-150 ease-standard ${
                  sort === value ? "bg-brand-soft text-brand-strong" : "text-ink-muted hover:bg-panel"
                }`}
              >
                {value === "latest" ? "最新" : "热门"}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => {
              setUnresolvedOnly((prev) => !prev);
              setPage(1);
            }}
            aria-pressed={unresolvedOnly}
            className={`co-focusable cursor-pointer rounded-md border px-3 py-1.5 text-[13px] font-medium transition-colors duration-150 ease-standard ${
              unresolvedOnly
                ? "border-brand bg-brand-soft text-brand-strong"
                : "border-line bg-canvas text-ink-muted hover:bg-panel"
            }`}
          >
            只看未解决
          </button>
        </div>
      </div>

      {status === "loading" ? <LoadingSkeleton variant="list" count={4} /> : null}

      {status === "error" ? (
        <ErrorState
          message="问题列表加载失败，请检查网络后重试。"
          onRetry={() => setReloadToken((token) => token + 1)}
        />
      ) : null}

      {status === "ready" && items.length === 0 ? (
        <EmptyState
          title="没有找到符合条件的问题"
          description="换个关键词，或取消筛选条件再试一次。"
          actionLabel="清除筛选"
          onAction={() => {
            setKeyword("");
            setUnresolvedOnly(false);
            setSort("latest");
            setPage(1);
          }}
        />
      ) : null}

      {status === "ready" && items.length > 0 ? (
        <>
          <ul className="flex flex-col gap-3">
            {items.map((question) => (
              <li key={question.id}>
                <QuestionCard question={question} />
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
    </section>
  );
}
