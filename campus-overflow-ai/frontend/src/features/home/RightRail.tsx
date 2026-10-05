"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { fetchRanking } from "@/api/reputation";
import { fetchTags } from "@/api/tags";
import type { RankRow } from "@/shared/types/reputation";
import type { TagListItem } from "@/shared/types/tag";

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
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [hotTags, ranking] = await Promise.all([
          fetchTags({ hot: true }),
          fetchRanking({ period: "all" }),
        ]);
        if (cancelled) return;
        setTags(hotTags.items);
        setRankRows(ranking.items);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (failed) {
    return <p className="px-1 text-[12px] text-ink-subtle">边栏内容暂时无法加载，刷新页面可重试。</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      <RailCard title="热门标签">
        {tags === null ? (
          <RailSkeleton />
        ) : tags.length === 0 ? (
          <p className="text-[12px] text-ink-subtle">暂无热门标签</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {tags.slice(0, 6).map((tag) => (
              <li key={tag.id} className="flex items-center justify-between gap-2">
                <Link
                  href={`/tags/${tag.id}`}
                  className="co-focusable rounded-full bg-brand-soft px-2.5 py-1 text-[12px] font-medium text-brand-strong hover:bg-brand/10"
                >
                  {tag.name}
                </Link>
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
        ) : rankRows.length === 0 ? (
          <p className="text-[12px] text-ink-subtle">暂无积分记录</p>
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

    </div>
  );
}
