"use client";

import { useState } from "react";

import { LoadingSkeleton } from "./LoadingSkeleton";

// AI 建议卡片：三种状态（生成中 / 失败重试 / 待人工确认）+ 未确认不写入
// 见 docs/前端架构/设计系统.md §3.4
export type AiCardState = "loading" | "error" | "ready";

export interface AiSuggestion {
  id: string;
  label: string;
  reason?: string;
  confidence?: number;
}

export function AiSuggestionCard({
  title,
  state,
  items = [],
  onRetry,
  onConfirm,
  confirmLabel = "确认写入",
}: {
  title: string;
  state: AiCardState;
  items?: AiSuggestion[];
  onRetry?: () => void;
  onConfirm?: (ids: string[]) => void;
  confirmLabel?: string;
}) {
  const [selected, setSelected] = useState<string[]>([]);

  const toggle = (id: string) =>
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  return (
    <section
      aria-label={title}
      className="rounded-lg border border-dashed border-brand-line bg-brand-soft p-4"
    >
      <header className="flex items-center gap-2">
        <span className="inline-block h-3 w-3 rounded-sm border border-brand" aria-hidden="true" />
        <h3 className="text-[14px] font-semibold text-brand-strong">{title}</h3>
        <span className="rounded-sm bg-canvas px-1.5 py-0.5 text-[11px] font-medium text-brand-strong">
          AI 辅助参考
        </span>
      </header>

      {state === "loading" ? (
        <div className="mt-3">
          <p className="mb-2 text-[13px] text-ink-muted">正在检索站内问题…</p>
          <LoadingSkeleton variant="list" count={2} />
        </div>
      ) : null}

      {state === "error" ? (
        <div className="mt-3 flex items-center justify-between gap-3">
          <p className="text-[13px] text-ink-muted">AI 建议暂不可用，不影响正常提问</p>
          {onRetry ? (
            <button
              type="button"
              onClick={onRetry}
              className="co-focusable cursor-pointer rounded-md border border-line bg-canvas px-3 py-1.5 text-[13px] font-medium text-ink transition-colors duration-150 ease-standard hover:bg-panel"
            >
              重试
            </button>
          ) : null}
        </div>
      ) : null}

      {state === "ready" ? (
        <div className="mt-3">
          {items.length === 0 ? (
            <p className="text-[13px] text-ink-muted">未找到站内相似问题</p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {items.map((item) => (
                <li key={item.id} className="flex items-start gap-2">
                  <input
                    id={`ai-${item.id}`}
                    type="checkbox"
                    checked={selected.includes(item.id)}
                    onChange={() => toggle(item.id)}
                    className="co-focusable mt-1 cursor-pointer accent-brand"
                  />
                  <label htmlFor={`ai-${item.id}`} className="cursor-pointer text-[13px] text-ink">
                    <span className="font-medium">{item.label}</span>
                    {item.reason ? (
                      <span className="ml-1 text-ink-muted">· {item.reason}</span>
                    ) : null}
                    {typeof item.confidence === "number" ? (
                      <span className="ml-1 text-ink-subtle">
                        · 置信度 {Math.round(item.confidence * 100)}%
                      </span>
                    ) : null}
                  </label>
                </li>
              ))}
            </ul>
          )}

          <div className="mt-3 flex items-center justify-between gap-3">
            <p className="text-[12px] text-ink-muted">未勾选确认前，不会写入任何数据</p>
            <button
              type="button"
              disabled={selected.length === 0}
              onClick={() => onConfirm?.(selected)}
              className="co-focusable cursor-pointer rounded-md bg-brand px-3 py-1.5 text-[13px] font-medium text-white transition-colors duration-150 ease-standard hover:bg-brand-strong disabled:cursor-not-allowed disabled:bg-line disabled:text-ink-subtle"
            >
              {confirmLabel}
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
