"use client";

export type VoteDirection = 1 | -1;

// 竖排投票：▲ 分数 ▼；再点同向 = 取消，由父层根据 myVote 处理，本组件只回调方向
export function VoteWidget({
  score,
  myVote,
  onVote,
  isLoggedIn = true,
  onNeedLogin,
  disabled = false,
}: {
  score: number;
  myVote: 1 | 0 | -1;
  onVote: (direction: VoteDirection) => void;
  isLoggedIn?: boolean;
  onNeedLogin?: () => void;
  disabled?: boolean;
}) {
  const handleVote = (direction: VoteDirection) => {
    if (disabled) return;
    if (!isLoggedIn) {
      onNeedLogin?.();
      return;
    }
    onVote(direction);
  };

  const buttonClass = (isActive: boolean) =>
    `co-focusable flex h-8 w-8 cursor-pointer items-center justify-center rounded-sm text-[13px] transition-colors duration-150 ease-standard disabled:cursor-not-allowed disabled:opacity-50 ${
      isActive
        ? "bg-brand-soft text-brand-strong"
        : "text-ink-subtle hover:bg-panel hover:text-ink"
    }`;

  return (
    <div role="group" aria-label="投票" className="flex w-10 flex-col items-center gap-0.5">
      <button
        type="button"
        aria-label="赞同"
        aria-pressed={myVote === 1}
        disabled={disabled}
        onClick={() => handleVote(1)}
        className={buttonClass(myVote === 1)}
      >
        ▲
      </button>
      {/* 分数全角色可见，仅投票动作受登录/权限约束 */}
      <span className="text-[14px] font-semibold tabular-nums text-ink">{score}</span>
      <button
        type="button"
        aria-label="反对"
        aria-pressed={myVote === -1}
        disabled={disabled}
        onClick={() => handleVote(-1)}
        className={buttonClass(myVote === -1)}
      >
        ▼
      </button>
    </div>
  );
}
