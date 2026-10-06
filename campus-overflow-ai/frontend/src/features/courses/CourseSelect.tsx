"use client";

import { useEffect, useState } from "react";

import { fetchCourseDetail, fetchCourses } from "@/api/courses";
import { ErrorState, LoadingSkeleton } from "@/shared/components";
import type { CourseListItem } from "@/shared/types/course";

type LoadStatus = "loading" | "ready" | "error";

// 每页 50 门
const PAGE_SIZE = 50;

/**
 * 课程选择器：课程列表是分页接口（没有"全量"接口），所以
 * 课程数超过一页时提供关键词搜索 + 逐页「加载更多」，避免把第一页当成全部课程。
 */
export function CourseSelect({
  label,
  value,
  onChange,
  placeholder = "请选择课程",
}: {
  label: string;
  value?: number;
  onChange: (id: number | undefined) => void;
  placeholder?: string;
}) {
  const [keyword, setKeyword] = useState("");
  const [items, setItems] = useState<CourseListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<LoadStatus>("loading");
  const [reloadToken, setReloadToken] = useState(0);
  // 深链接带入的课程可能不在当前页，单独取一次详情补进选项
  const [pinned, setPinned] = useState<{ id: number; name: string; code: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      // 先让出一次微任务：避免在 effect 中同步 setState（react-hooks/set-state-in-effect）
      await Promise.resolve();
      if (cancelled) return;
      setStatus("loading");
      try {
        const result = await fetchCourses({
          page,
          page_size: PAGE_SIZE,
          keyword: keyword.trim() || undefined,
        });
        if (cancelled) return;
        setItems((prev) => (page === 1 ? result.items : [...prev, ...result.items]));
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

  /**
   * /questions/new?course_id=75、/rankings?course_id=75 这类深链接：初始课程可能不在第一页。
   * 补取一次课程详情并放进选项，避免"下拉显示为空、状态里却还留着 id"的展示与状态不一致。
   */
  useEffect(() => {
    if (!value) return;
    if (items.some((course) => course.id === value)) return;
    let cancelled = false;
    void fetchCourseDetail(value)
      .then((detail) => {
        if (!cancelled) setPinned({ id: detail.id, name: detail.name, code: detail.code });
      })
      .catch(() => {
        // 取不到详情就不补选项：值仍保留，提交/查询以后端校验为准
      });
    return () => {
      cancelled = true;
    };
  }, [value, items]);

  if (status === "error") {
    return (
      <ErrorState
        message="课程列表加载失败，请检查网络后重试。"
        onRetry={() => setReloadToken((token) => token + 1)}
      />
    );
  }

  if (status === "loading" && items.length === 0) {
    return <LoadingSkeleton variant="list" count={1} />;
  }

  // 课程超过一页时才需要搜索（课程不多时保持原来的下拉体验）；
  // 关键词非空时必须保留搜索框，否则搜到 0 条后用户无法修改或清除关键词。
  const searchable = total > PAGE_SIZE || keyword.trim() !== "";
  const pinnedOption =
    value && !items.some((course) => course.id === value) && pinned?.id === value ? pinned : null;

  return (
    <div className="flex flex-col gap-2">
      {searchable ? (
        <input
          value={keyword}
          onChange={(event) => {
            setKeyword(event.target.value);
            setPage(1);
          }}
          placeholder="搜索课程名或编码"
          aria-label="搜索课程名或编码"
          className="co-focusable h-11 w-full rounded-md border border-line bg-canvas px-3 text-[14px] text-ink transition-colors duration-150 ease-standard placeholder:text-ink-subtle hover:border-ink-subtle focus:border-brand focus:ring-2 focus:ring-brand/20"
        />
      ) : null}

      <select
        value={value ?? ""}
        onChange={(event) => onChange(event.target.value ? Number(event.target.value) : undefined)}
        aria-label={label}
        className="co-focusable h-11 w-full cursor-pointer rounded-md border border-line bg-canvas px-3 text-[14px] text-ink transition-colors duration-150 ease-standard hover:border-ink-subtle"
      >
        <option value="">{placeholder}</option>
        {pinnedOption ? (
          <option value={pinnedOption.id}>
            {pinnedOption.name}（{pinnedOption.code}）
          </option>
        ) : null}
        {items.map((course) => (
          <option key={course.id} value={course.id}>
            {course.name}（{course.code}）
          </option>
        ))}
      </select>

      {status === "ready" && items.length === 0 ? (
        <p className="text-[12px] text-ink-subtle">没有匹配的课程，换个关键词试试。</p>
      ) : null}

      {items.length < total ? (
        <button
          type="button"
          disabled={status === "loading"}
          onClick={() => setPage((current) => current + 1)}
          className="co-focusable cursor-pointer self-start rounded-md border border-line bg-canvas px-3 py-1.5 text-[13px] text-ink-muted transition-colors duration-150 ease-standard hover:bg-panel disabled:cursor-not-allowed disabled:text-ink-subtle"
        >
          加载更多课程（已显示 {items.length} / {total}）
        </button>
      ) : null}
    </div>
  );
}
