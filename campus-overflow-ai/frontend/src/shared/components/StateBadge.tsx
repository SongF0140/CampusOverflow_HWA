// 状态徽标语义入口：问题/课程/账号的领域状态展示，与 StatusBadge 同为「色块 + 文字」
// （设计系统 §3.3：状态不能只靠颜色区分）；tone 键与领域状态命名一致
export type StateBadgeTone =
  | "unresolved"
  | "resolved"
  | "banned"
  | "active"
  | "closed"
  | "hidden";

const STATE_MAP: Record<StateBadgeTone, { label: string; className: string }> = {
  unresolved: { label: "未解决", className: "bg-warning-soft text-warning-ink" },
  resolved: { label: "已解决", className: "bg-success-soft text-success-ink" },
  banned: { label: "已封禁", className: "bg-danger-soft text-danger-ink" },
  active: { label: "进行中", className: "bg-brand-soft text-brand-strong" },
  closed: { label: "已结课", className: "bg-panel text-ink-muted" },
  hidden: { label: "已隐藏", className: "bg-panel text-ink-muted" },
};

export function StateBadge({ tone, label }: { tone: StateBadgeTone; label?: string }) {
  const item = STATE_MAP[tone];
  return (
    <span
      className={`inline-flex items-center rounded-sm px-2 py-0.5 text-[12px] font-medium ${item.className}`}
    >
      {label ?? item.label}
    </span>
  );
}
