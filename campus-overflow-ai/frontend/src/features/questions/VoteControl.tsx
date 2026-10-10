"use client";

// 投票控件（纯展示）：分数与我的票向由父组件传入，点击回调交父组件做乐观更新
export function VoteControl({
  score,
  myVote,
  disabled = false,
  onVote,
  label = "票数",
}: {
  score: number;
  myVote: number;
  disabled?: boolean;
  onVote: (value: 1 | -1) => void;
  label?: string;
}) {
  const base =
    "co-focusable h-7 w-7 rounded-md border text-[13px] leading-none transition-colors duration-150 ease-standard disabled:cursor-not-allowed disabled:opacity-60";

  return (
    <div className="flex flex-col items-center gap-1">
      <button
        type="button"
        disabled={disabled}
        onClick={() => onVote(1)}
        aria-label={`赞同（${label}）`}
        aria-pressed={myVote === 1}
        className={`${base} cursor-pointer ${
          myVote === 1
            ? "border-brand bg-brand-soft text-brand-strong"
            : "border-line bg-canvas text-ink-muted hover:bg-panel"
        }`}
      >
        ▲
      </button>
      <span className="text-[13px] font-medium text-ink" aria-live="polite">
        {score}
      </span>
      <button
        type="button"
        disabled={disabled}
        onClick={() => onVote(-1)}
        aria-label={`反对（${label}）`}
        aria-pressed={myVote === -1}
        className={`${base} cursor-pointer ${
          myVote === -1
            ? "border-danger-line bg-danger-soft text-danger-ink"
            : "border-line bg-canvas text-ink-muted hover:bg-panel"
        }`}
      >
        ▼
      </button>
    </div>
  );
}
