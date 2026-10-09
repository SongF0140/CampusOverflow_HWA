"use client";

import { useEffect, useRef } from "react";
import type { ReactNode } from "react";

import { trapFocus } from "./dialogA11y";

// 右侧滑出容器（固定 400px）：交互与 Modal 一致（遮罩/Escape 关闭 + 焦点圈）
export function Drawer({
  open,
  onClose,
  title,
  children,
  footer,
  className = "",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
}) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
        return;
      }
      if (event.key === "Tab") trapFocus(event, panelRef.current);
    };
    document.addEventListener("keydown", handleKeyDown);
    panelRef.current?.focus();
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-black/30"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={`flex h-full w-[400px] max-w-[90vw] flex-col overflow-y-auto border-l border-line bg-canvas p-6 outline-none ${className}`}
      >
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-[16px] font-semibold text-ink">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭"
            className="co-focusable cursor-pointer rounded-sm px-1.5 text-[18px] leading-none text-ink-subtle transition-colors duration-150 ease-standard hover:text-ink"
          >
            ×
          </button>
        </div>
        <div className="mt-4 flex-1 text-[14px] leading-relaxed text-ink-muted">{children}</div>
        {footer ? <div className="mt-6 flex justify-end gap-2">{footer}</div> : null}
      </div>
    </div>
  );
}
