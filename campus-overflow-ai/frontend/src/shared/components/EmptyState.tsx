// 空状态：说明"为什么空 + 下一步做什么"，并给一个主操作（设计系统 §5）
export function EmptyState({
  title,
  description,
  actionLabel,
  onAction,
}: {
  title: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-line bg-panel px-6 py-12 text-center">
      <p className="text-[15px] font-semibold text-ink">{title}</p>
      {description ? <p className="max-w-[42ch] text-[13px] leading-relaxed text-ink-muted">{description}</p> : null}
      {actionLabel && onAction ? (
        <button
          type="button"
          onClick={onAction}
          className="co-focusable mt-1 cursor-pointer rounded-md bg-brand px-4 py-2 text-[14px] font-medium text-white transition-colors duration-150 ease-standard hover:bg-brand-strong"
        >
          {actionLabel}
        </button>
      ) : null}
    </div>
  );
}
