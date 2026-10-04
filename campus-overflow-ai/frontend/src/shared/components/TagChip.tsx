// 标签：浅色底 + 同色系深色字（设计系统 §3.4）
export function TagChip({
  label,
  selected = false,
  onClick,
}: {
  label: string;
  selected?: boolean;
  onClick?: () => void;
}) {
  const base = "inline-flex items-center rounded-full px-3 py-1 text-[12px] font-medium";
  if (!onClick) {
    return <span className={`${base} bg-brand-soft text-brand-strong`}>{label}</span>;
  }
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={`${base} co-focusable cursor-pointer border transition-colors duration-150 ease-standard ${
        selected
          ? "border-brand bg-brand-soft text-brand-strong"
          : "border-line bg-canvas text-ink-muted hover:bg-panel"
      }`}
    >
      {label}
    </button>
  );
}
