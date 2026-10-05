import { StatusBadge, type StatusTone } from "./StatusBadge";

// 状态徽标语义入口：与 StatusBadge 共用同一套"色块 + 文字"实现，避免重复组件
// 覆盖：未解决/已解决/已封禁/进行中/已结课/已隐藏/高风险
export type StateBadgeTone = StatusTone;

export function StateBadge({ tone, label }: { tone: StateBadgeTone; label?: string }) {
  return <StatusBadge tone={tone} label={label} />;
}
