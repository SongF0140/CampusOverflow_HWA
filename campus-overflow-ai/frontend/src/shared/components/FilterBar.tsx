import type { ReactNode } from "react";

// 布局容器：左主操作、右筛选，窄屏自动换行（问题广场筛选条等）
export function FilterBar({
  actions,
  filters,
  className = "",
}: {
  actions?: ReactNode;
  filters?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`flex flex-wrap items-center justify-between gap-3 ${className}`}>
      <div className="flex flex-wrap items-center gap-2">{actions}</div>
      <div className="flex flex-wrap items-center gap-2">{filters}</div>
    </div>
  );
}
