"use client";

export interface TabNavItem {
  key: string;
  label: string;
}

// 页内页签/排序筛选：受控按钮模式，当前项 brand 下划线高亮
export function TabNav({
  tabs,
  active,
  onChange,
  className = "",
}: {
  tabs: TabNavItem[];
  active: string;
  onChange: (key: string) => void;
  className?: string;
}) {
  return (
    <div role="tablist" className={`flex items-end gap-1 border-b border-line ${className}`}>
      {tabs.map((tab) => {
        const isActive = tab.key === active;
        return (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(tab.key)}
            className={`co-focusable relative h-10 cursor-pointer px-3 text-[14px] font-medium transition-colors duration-150 ease-standard ${
              isActive ? "text-brand" : "text-ink-muted hover:text-ink"
            }`}
          >
            {tab.label}
            {isActive ? (
              <span
                aria-hidden="true"
                className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-brand"
              />
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
