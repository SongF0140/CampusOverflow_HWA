"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { fetchRelatedQuestions } from "@/api/questions";
import type { QuestionListItem } from "@/shared/types/question";

export function RelatedQuestions({ questionId }: { questionId: number }) {
  const [items, setItems] = useState<QuestionListItem[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const result = await fetchRelatedQuestions(questionId);
        if (!cancelled) setItems(result.items);
      } catch {
        // AI/相关问题不可用不影响主流程：右上角直接不展示
        if (!cancelled) setItems([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [questionId]);

  return (
    <section className="rounded-lg border border-line bg-canvas p-4">
      <h2 className="text-[14px] font-semibold text-ink">相关问题</h2>
      <div className="mt-3">
        {items === null ? (
          <div className="flex flex-col gap-2" role="status" aria-live="polite">
            <span className="sr-only">正在加载相关问题</span>
            {[0, 1, 2].map((row) => (
              <div key={row} className="co-skeleton h-4 rounded-sm" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <p className="text-[12px] text-ink-muted">暂无相关问题</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {items.slice(0, 5).map((item) => (
              <li key={item.id}>
                <Link
                  href={`/questions/${item.id}`}
                  className="co-focusable text-[13px] leading-snug text-ink hover:text-brand"
                >
                  {item.title}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
