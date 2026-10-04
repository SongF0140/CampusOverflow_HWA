"use client";

import { useEffect, useState } from "react";

import { EmptyState, ErrorState, LoadingSkeleton } from "@/shared/components";
import type { QuestionListItem, QuestionSort } from "@/shared/types/question";

import { QuestionCard } from "./QuestionCard";
import { fetchQuestionList } from "./mock";

type LoadStatus = "loading" | "ready" | "error";

export function QuestionList({
  initialKeyword = "",
  initialSort = "latest",
  initialUnresolved = false,
}: {
  initialKeyword?: string;
  initialSort?: QuestionSort;
  initialUnresolved?: boolean;
}) {
  const [keyword, setKeyword] = useState(initialKeyword);
  const [sort, setSort] = useState<QuestionSort>(initialSort);
  const [unresolvedOnly, setUnresolvedOnly] = useState(initialUnresolved);
  const [items, setItems] = useState<QuestionListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [status, setStatus] = useState<LoadStatus>("loading");
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      // 先让出一次微任务：避免在 effect 中同步 setState（react-hooks/set-state-in-effect）
      await Promise.resolve();
      if (cancelled) return;
      setStatus("loading");
      try {
        const result = await fetchQuestionList({ keyword, sort, unresolved: unresolvedOnly });
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
  }, [keyword, sort, unresolvedOnly, reloadToken]);

  // 筛选条件写进 URL，便于回填与分享（参数名与真接口一致）
  useEffect(() => {
    const params = new URLSearchParams();
    if (keyword.trim()) params.set("keyword", keyword.trim());
    if (sort === "hot") params.set("sort", "hot");
    if (unresolvedOnly) params.set("unresolved", "1");
    const query = params.toString();
    window.history.replaceState(null, "", query ? `/?${query}` : "/");
  }, [keyword, sort, unresolvedOnly]);

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-[22px] font-semibold text-ink">问题广场</h1>
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            placeholder="搜索问题标题"
            aria-label="搜索问题标题"
            className="co-focusable h-9 w-[220px] rounded-md border border-line bg-canvas px-3 text-[13px] text-ink transition-colors duration-150 ease-standard placeholder:text-ink-subtle hover:border-ink-subtle focus:border-brand focus:ring-2 focus:ring-brand/20"
          />
          <div className="flex items-center gap-1 rounded-md border border-line bg-canvas p-0.5">
            {(["latest", "hot"] as QuestionSort[]).map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setSort(value)}
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
            onClick={() => setUnresolvedOnly((prev) => !prev)}
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
          <p className="text-[12px] text-ink-subtle">共 {total} 条（当前为演示数据，接口合并后切换为真实数据）</p>
        </>
      ) : null}
    </section>
  );
}
