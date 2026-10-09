"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { getRank } from "@/api/reputation";
import { listTags } from "@/api/tags";
import { UserLine } from "@/shared/components";
import type { RankingEntry } from "@/shared/types/reputation";
import type { TagListItem } from "@/shared/types/tag";

function RailCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-line bg-canvas p-4">
      <h2 className="text-[14px] font-semibold text-ink">{title}</h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}

// 右栏（§2.3）：热门用户（周榜 TOP5 + 完整榜单入口）与热门标签
// 数据为空的卡片整体隐藏，不渲染占位壳
export function RightRail() {
  const [tags, setTags] = useState<TagListItem[] | null>(null);
  const [rankRows, setRankRows] = useState<RankingEntry[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [hotTags, ranking] = await Promise.all([
          listTags({ hot: true }),
          getRank({ period: "week" }),
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
      {rankRows !== null && rankRows.length > 0 ? (
        <RailCard title="热门用户">
          {/* 榜单接口只返回用户名与积分，公开场景统一按学生徽标展示 */}
          <ol className="flex flex-col gap-3">
            {rankRows.slice(0, 5).map((row) => (
              <li key={row.user_id}>
                <UserLine
                  userId={row.user_id}
                  nickname={row.username}
                  role="student"
                  size="sm"
                />
              </li>
            ))}
          </ol>
          <Link
            href="/rankings"
            className="co-focusable mt-3 inline-block text-[12px] text-ink-muted underline-offset-2 transition-colors duration-150 ease-standard hover:text-brand hover:underline"
          >
            查看完整榜单
          </Link>
        </RailCard>
      ) : null}

      {tags !== null && tags.length > 0 ? (
        <RailCard title="热门标签">
          <div className="flex flex-wrap gap-1.5">
            {tags.slice(0, 8).map((tag) => (
              <Link
                key={tag.id}
                href={`/tags/${tag.id}`}
                className="co-focusable rounded-full bg-brand-soft px-2.5 py-1 text-[12px] font-medium text-brand-strong transition-colors duration-150 ease-standard hover:bg-brand/10"
              >
                {tag.name}
              </Link>
            ))}
          </div>
        </RailCard>
      ) : null}
    </div>
  );
}
