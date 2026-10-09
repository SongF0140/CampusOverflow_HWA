"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { listCourses } from "@/api/courses";
import { getRank } from "@/api/reputation";
import {
  EmptyState,
  ErrorState,
  LoadingSkeleton,
  Select,
  TabNav,
  UserLine,
} from "@/shared/components";
import { useAsyncData } from "@/shared/hooks/useAsyncData";
import type { Course } from "@/shared/types/course";
import type { RankPeriod } from "@/shared/types/reputation";

export type RankingTab = "week" | "month" | "course";

const RANK_TABS = [
  { key: "week", label: "周榜" },
  { key: "month", label: "月榜" },
  { key: "course", label: "课程榜" },
];

// 课程榜维度 = period=all + course_id（后端 period 仅接受 week|month|all，无 course 枚举）
const TAB_PERIOD: Record<RankingTab, RankPeriod> = {
  week: "week",
  month: "month",
  course: "all",
};

const COURSE_OPTION_LIMIT = 100;

// 前三名红底徽标 + 其余名次纯文本（设计系统语义色）
const TOP_BADGE =
  "inline-flex h-6 w-6 items-center justify-center rounded-full bg-danger-soft text-[13px] font-semibold text-danger-ink";
const PLAIN_BADGE =
  "inline-flex h-6 w-6 items-center justify-center text-[13px] font-medium text-ink-muted";

function isRankingTab(key: string): key is RankingTab {
  return RANK_TABS.some((tab) => tab.key === key);
}

// 排行榜（页面控件级设计说明 §2.10）：周榜/月榜/课程榜 Tab + 课程 Select + 榜单表
// Tab/课程切换写 URL（默认周榜不写参数），刷新后由服务端解析回填 initialTab
export function RankingsView({
  initialTab,
  initialCourseId,
}: {
  initialTab: RankingTab;
  initialCourseId: number | null;
}) {
  const router = useRouter();

  const [tab, setTab] = useState<RankingTab>(initialTab);
  const [courseId, setCourseId] = useState<number | null>(initialCourseId);

  // 课程选项：课程榜 Select 与首课默认选中共用
  const coursesState = useAsyncData(
    () => listCourses({ page: 1, page_size: COURSE_OPTION_LIMIT }),
    [],
  );
  const courses: Course[] = coursesState.data?.items ?? [];

  // 课程榜的有效课程 id：未手动选择时派生第一门课（courseId 为空且课程未到时不发榜单请求）
  const effectiveCourseId =
    tab === "course" ? (courseId ?? courses[0]?.id ?? null) : null;

  // Tab/课程切换写 URL：period/course_id 直接映射后端查询参数
  useEffect(() => {
    const params = new URLSearchParams();
    if (tab === "month") params.set("period", "month");
    if (tab === "course" && effectiveCourseId !== null) {
      params.set("period", "all");
      params.set("course_id", String(effectiveCourseId));
    }
    const query = params.toString();
    window.history.replaceState(null, "", query ? `/rankings?${query}` : "/rankings");
  }, [tab, effectiveCourseId]);

  const rankState = useAsyncData(
    async () => {
      if (tab === "course" && effectiveCourseId === null) return [];
      const result = await getRank({
        period: TAB_PERIOD[tab],
        course_id:
          tab === "course" && effectiveCourseId !== null ? effectiveCourseId : undefined,
      });
      return result.items;
    },
    [tab, effectiveCourseId],
  );
  const entries = rankState.data ?? [];
  const isReady = !rankState.isLoading && rankState.error === null;

  function handleTabChange(key: string) {
    if (!isRankingTab(key)) return;
    setTab(key);
    // 离开课程榜时清空课程选择，回到周/月维度
    if (key !== "course") setCourseId(null);
  }

  return (
    <div className="flex flex-col gap-5">
      <h1 className="text-[22px] font-semibold text-ink">排行榜</h1>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <TabNav tabs={RANK_TABS} active={tab} onChange={handleTabChange} className="border-none" />
        {tab === "course" ? (
          <div className="w-full sm:w-64">
            <Select
              aria-label="选择课程"
              value={effectiveCourseId !== null ? String(effectiveCourseId) : ""}
              onChange={(event) => {
                const value = Number(event.target.value);
                setCourseId(Number.isInteger(value) && value > 0 ? value : null);
              }}
              options={courses.map((course) => ({
                value: String(course.id),
                label: course.name,
              }))}
            />
          </div>
        ) : null}
      </div>

      {rankState.isLoading ? <LoadingSkeleton variant="list" count={6} /> : null}

      {rankState.error !== null ? (
        <ErrorState message={rankState.error} onRetry={rankState.reload} />
      ) : null}

      {isReady && entries.length === 0 ? (
        <EmptyState
          title="暂无榜单数据"
          description={
            tab === "course"
              ? "该课程在当前统计窗口内还没有声望变动。"
              : "当前统计窗口内还没有声望变动。"
          }
        />
      ) : null}

      {isReady && entries.length > 0 ? (
        <div className="overflow-x-auto rounded-lg border border-line bg-canvas">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-line text-[12px] text-ink-subtle">
                <th scope="col" className="py-3 pl-5 pr-4 font-medium">名次</th>
                <th scope="col" className="py-3 pr-4 font-medium">用户</th>
                <th scope="col" className="py-3 pr-4 font-medium">声望值</th>
                {/* TODO(接口差异)：后端 rank 接口仅返回 user_id/username/score，提问数/回答数/采纳率待后端补充后渲染 */}
                <th scope="col" className="py-3 pr-4 font-medium">提问数</th>
                <th scope="col" className="py-3 pr-4 font-medium">回答数</th>
                <th scope="col" className="py-3 pr-4 font-medium">采纳率</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry, index) => {
                const rank = index + 1;
                return (
                  <tr
                    key={entry.user_id}
                    onClick={() => router.push(`/users/${entry.user_id}`)}
                    className="cursor-pointer border-b border-line transition-colors duration-150 ease-standard last:border-b-0 hover:bg-panel"
                  >
                    <td className="py-3 pl-5 pr-4">
                      {rank <= 3 ? (
                        <span className={TOP_BADGE}>{rank}</span>
                      ) : (
                        <span className={PLAIN_BADGE}>{rank}</span>
                      )}
                    </td>
                    <td className="py-3 pr-4">
                      {/* 榜单条目无角色字段，暂按学生徽标展示（同课程活跃用户做法） */}
                      <UserLine
                        userId={entry.user_id}
                        nickname={entry.username}
                        role="student"
                        size="sm"
                      />
                    </td>
                    <td className="py-3 pr-4 text-[14px] font-medium text-ink">{entry.score}</td>
                    <td className="py-3 pr-4 text-[13px] text-ink-muted">—</td>
                    <td className="py-3 pr-4 text-[13px] text-ink-muted">—</td>
                    <td className="py-3 pr-4 text-[13px] text-ink-muted">—</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
