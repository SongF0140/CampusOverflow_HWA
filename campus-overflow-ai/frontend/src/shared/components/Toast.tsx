"use client";

// 顶部提示条：提交成功 / 失败反馈（设计系统 §5：150ms 滑入）
export type ToastTone = "success" | "error" | "info";

const TONE_MAP: Record<ToastTone, string> = {
  success: "border-success/40 bg-success-soft text-success-ink",
  error: "border-danger-line bg-danger-soft text-danger-ink",
  info: "border-line bg-panel text-ink",
};

export function Toast({
  tone = "info",
  message,
  onClose,
}: {
  tone?: ToastTone;
  message: string;
  onClose?: () => void;
}) {
  return (
    <div
      role="status"
      className={`flex items-center justify-between gap-3 rounded-md border px-4 py-2.5 text-[13px] ${TONE_MAP[tone]}`}
    >
      <span>{message}</span>
      {onClose ? (
        <button
          type="button"
          onClick={onClose}
          aria-label="关闭提示"
          className="co-focusable cursor-pointer text-[12px] text-ink-muted transition-colors duration-150 ease-standard hover:text-ink"
        >
          关闭
        </button>
      ) : null}
    </div>
  );
}
