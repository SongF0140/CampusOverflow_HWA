import type { ReactNode } from "react";

// 卡片容器：12px 圆角 + 1px line 描边（设计系统 §2：不用重投影）
export function Card({
  children,
  isPadded = true,
  isHoverable = false,
  className = "",
}: {
  children: ReactNode;
  isPadded?: boolean;
  isHoverable?: boolean;
  className?: string;
}) {
  return (
    <div
      className={`rounded-lg border border-line bg-canvas ${isPadded ? "p-4" : ""} ${
        isHoverable
          ? "cursor-pointer transition-colors duration-150 ease-standard hover:border-ink-subtle"
          : ""
      } ${className}`}
    >
      {children}
    </div>
  );
}
