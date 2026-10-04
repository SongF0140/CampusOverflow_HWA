// 状态徽标：色块 + 文字（设计系统 §3.3：状态不能只靠颜色区分）
// tone 是「展示态」的键，刻意与后端问题状态值（published/resolved）区分开，避免两者混用。
export type StatusTone = "open" | "done" | "risk" | "hidden";

const TONE_MAP: Record<StatusTone, { label: string; className: string }> = {
  open: { label: "未解决", className: "bg-warning-soft text-warning-ink" },
  done: { label: "已解决", className: "bg-success-soft text-success-ink" },
  risk: { label: "高风险", className: "bg-danger-soft text-danger-ink" },
  hidden: { label: "已隐藏", className: "bg-panel text-ink-muted" },
};

export function StatusBadge({ tone, label }: { tone: StatusTone; label?: string }) {
  const item = TONE_MAP[tone];
  return (
    <span
      className={`inline-flex items-center rounded-sm px-2 py-0.5 text-[12px] font-medium ${item.className}`}
    >
      {label ?? item.label}
    </span>
  );
}
