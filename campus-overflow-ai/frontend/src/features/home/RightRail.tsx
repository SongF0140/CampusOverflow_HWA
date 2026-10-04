"use client";

import { useEffect, useState } from "react";

import type { RankRow } from "@/shared/types/reputation";
import type { TagListItem } from "@/shared/types/tag";

import { fetchHotTags, fetchRanking } from "./mock";

function RailCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-line bg-canvas p-4">
      <h2 className="text-[14px] font-semibold text-ink">{title}</h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function RailSkeleton() {
  return (
    <div className="flex flex-col gap-2" role="status" aria-live="polite">
      <span className="sr-only">正在加载边栏内容</span>
      {[0, 1, 2].map((row) => (
        <div key={row} className="co-skeleton h-4 rounded-sm" />
      ))}
    </div>
  );
}

export function RightRail() {
  const [tags, setTags] = useState<TagListItem[] | null>(null);
  const [rankRows, setRankRows] = useState<RankRow[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [hotTags, ranking] = await Promise.all([fetchHotTags(), fetchRanking()]);
      if (cancelled) return;
      setTags(hotTags);
      setRankRows(ranking);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="flex flex-col gap-4">
      {/* TODO(下一批页面): /tags/[id] 页面完成后，标签改为可点击跳转 */}
      <RailCard title="热门标签">
        {tags === null ? (
          <RailSkeleton />
        ) : (
          <ul className="flex flex-col gap-2">
            {tags.slice(0, 6).map((tag) => (
              <li key={tag.id} className="flex items-center justify-between gap-2">
                <span className="rounded-full bg-brand-soft px-2.5 py-1 text-[12px] font-medium text-brand-strong">
                  {tag.name}
                </span>
                <span className="text-[12px] text-ink-subtle">{tag.question_count} 个问题</span>
              </li>
            ))}
          </ul>
        )}
      </RailCard>

      {/* TODO(下一批页面): /rankings 页面完成后，榜单标题与条目改为可点击跳转 */}
      <RailCard title="积分榜 · 总榜 Top 5">
        {rankRows === null ? (
          <RailSkeleton />
        ) : (
          <ol className="flex flex-col gap-2">
            {rankRows.slice(0, 5).map((row, index) => (
              <li key={row.user_id} className="flex items-center gap-2 text-[13px]">
                <span className="w-5 shrink-0 text-center text-[12px] font-medium text-ink-subtle">
                  {index + 1}
                </span>
                <span className="min-w-0 flex-1 truncate text-ink">{row.username}</span>
                <span className="shrink-0 text-[12px] text-ink-muted">{row.score} 分</span>
              </li>
            ))}
          </ol>
        )}
      </RailCard>

      <p className="px-1 text-[11px] leading-relaxed text-ink-subtle">
        边栏为演示数据；接口合并后切换为「热门标签（/api/tags?hot=true）」与「积分榜（/api/reputation/rank）」的真实结果。
      </p>
    </div>
  );
}
