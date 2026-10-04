"use client";

import { useEffect } from "react";

// 危险操作二次确认（设计系统 §2：删除/封禁类必须有二次确认）
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = "确认",
  cancelLabel = "取消",
  danger = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  // 键盘可达：ESC 关闭（焦点默认落在"取消"上，避免误触危险操作）
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="w-full max-w-[420px] rounded-lg border border-line bg-canvas p-6 shadow-[0_1px_2px_rgba(15,15,15,0.06)]"
      >
        <h2 className="text-[16px] font-semibold text-ink">{title}</h2>
        {description ? (
          <p className="mt-2 text-[13px] leading-relaxed text-ink-muted">{description}</p>
        ) : null}
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            autoFocus
            className="co-focusable cursor-pointer rounded-md border border-line px-4 py-2 text-[13px] font-medium text-ink transition-colors duration-150 ease-standard hover:bg-panel"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={`co-focusable cursor-pointer rounded-md px-4 py-2 text-[13px] font-medium text-white transition-colors duration-150 ease-standard ${
              danger ? "bg-danger hover:opacity-90" : "bg-brand hover:bg-brand-strong"
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
