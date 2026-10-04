// 错误状态：中文说明 + 重试（设计系统 §5；不展示堆栈）
export function ErrorState({
  message = "服务暂时不可用，请稍后重试",
  onRetry,
}: {
  message?: string;
  onRetry?: () => void;
}) {
  return (
    <div
      role="alert"
      className="flex flex-col items-start gap-3 rounded-lg border border-line bg-canvas px-5 py-6"
    >
      <div className="flex items-center gap-2">
        <span className="h-2 w-2 rounded-full bg-danger" aria-hidden="true" />
        <p className="text-[15px] font-semibold text-ink">加载失败</p>
      </div>
      <p className="text-[13px] leading-relaxed text-ink-muted">{message}</p>
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="co-focusable cursor-pointer rounded-md border border-line px-3 py-1.5 text-[13px] font-medium text-ink transition-colors duration-150 ease-standard hover:bg-panel"
        >
          重新加载
        </button>
      ) : null}
    </div>
  );
}
