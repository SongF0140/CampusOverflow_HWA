"use client";

// 页码序列：超过 7 页折叠为省略号，首尾页恒在
function buildPageItems(current: number, totalPages: number): (number | "ellipsis")[] {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, i) => i + 1);
  }
  const items: (number | "ellipsis")[] = [1];
  const start = Math.max(2, current - 1);
  const end = Math.min(totalPages - 1, current + 1);
  if (start > 2) items.push("ellipsis");
  for (let i = start; i <= end; i += 1) items.push(i);
  if (end < totalPages - 1) items.push("ellipsis");
  items.push(totalPages);
  return items;
}

const ITEM_BASE =
  "co-focusable inline-flex h-10 min-w-10 cursor-pointer items-center justify-center rounded-md border px-2 text-[13px] font-medium transition-colors duration-150 ease-standard";

export function Pagination({
  page,
  pageSize,
  total,
  onChange,
  className = "",
}: {
  page: number;
  pageSize: number;
  total: number;
  onChange: (page: number) => void;
  className?: string;
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const isFirst = page <= 1;
  const isLast = page >= totalPages;

  return (
    <nav aria-label="分页" className={`flex items-center gap-1 ${className}`}>
      <button
        type="button"
        aria-label="上一页"
        disabled={isFirst}
        onClick={() => onChange(page - 1)}
        className={`${ITEM_BASE} border-line bg-canvas text-ink hover:bg-panel disabled:cursor-not-allowed disabled:opacity-50`}
      >
        上一页
      </button>
      {buildPageItems(page, totalPages).map((item, index) => {
        if (item === "ellipsis") {
          return (
            <span
              key={`ellipsis-${index}`}
              aria-hidden="true"
              className="inline-flex h-10 items-center px-1 text-[13px] text-ink-subtle"
            >
              …
            </span>
          );
        }
        const isCurrent = item === page;
        return (
          <button
            key={item}
            type="button"
            aria-current={isCurrent ? "page" : undefined}
            disabled={isCurrent}
            onClick={() => onChange(item)}
            className={`${ITEM_BASE} ${
              isCurrent
                ? "cursor-default border-brand bg-brand-soft text-brand-strong"
                : "border-line bg-canvas text-ink hover:bg-panel"
            }`}
          >
            {item}
          </button>
        );
      })}
      <button
        type="button"
        aria-label="下一页"
        disabled={isLast}
        onClick={() => onChange(page + 1)}
        className={`${ITEM_BASE} border-line bg-canvas text-ink hover:bg-panel disabled:cursor-not-allowed disabled:opacity-50`}
      >
        下一页
      </button>
    </nav>
  );
}
