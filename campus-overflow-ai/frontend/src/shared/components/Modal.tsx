"use client";

import { useEffect, useRef } from "react";
import type { ReactNode } from "react";

import { trapFocus } from "./dialogA11y";

// 居中弹窗：遮罩点击 / Escape 关闭；焦点进入面板并在面板内循环
export function Modal({
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
    // 打开后焦点先落在面板上，避免焦点残留在被遮住的页面里
    panelRef.current?.focus();
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-4"
      onClick={(event) => {
        // 只响应遮罩自身的点击；面板内的点击不关闭
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={`w-full max-w-[520px] rounded-lg border border-line bg-canvas p-6 shadow-[0_1px_2px_rgba(15,15,15,0.06)] outline-none ${className}`}
      >
        <h2 className="text-[16px] font-semibold text-ink">{title}</h2>
        <div className="mt-3 text-[14px] leading-relaxed text-ink-muted">{children}</div>
        {footer ? <div className="mt-6 flex justify-end gap-2">{footer}</div> : null}
      </div>
    </div>
  );
}
