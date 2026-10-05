"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { fetchCourses } from "@/api/courses";
import { fetchRanking } from "@/api/reputation";
import { EmptyState, ErrorState, LoadingSkeleton } from "@/shared/components";
import { RANK_PERIOD_LABEL, RANK_PERIODS, type RankPeriod } from "@/shared/constants/domain";
import type { CourseListItem } from "@/shared/types/course";
import type { RankRow } from "@/shared/types/reputation";

type LoadStatus = "loading" | "ready" | "error";

const DEFAULT_PERIOD: RankPeriod = "all";

/** 排行榜（P-S07）：周/月/总榜切换 + 课程榜；后端不返回名次字段，名次由前端按顺序计算 */
export function RankingView({
  initialPeriod = DEFAULT_PERIOD,
  initialCourseId,
}: {
  initialPeriod?: RankPeriod;
  initialCourseId?: number;
}) {
  const [period, setPeriod] = useState<RankPeriod>(initialPeriod);
  const [courseId, setCourseId] = useState<number | undefined>(initialCourseId);
  const [rows, setRows] = useState<RankRow[]>([]);
  const [courses, setCourses] = useState<CourseListItem[]>([]);
  const [status, setStatus] = useState<LoadStatus>("loading");
  const [reloadToken, setReloadToken] = useState(0);

  // 课程下拉数据：课程榜的入参就是 course_id，下拉失败不阻断榜单本身
  useEffect(() => {
    let cancelled = false;
    void fetchCourses({ page_size: 100 })
      .then((result) => {
        if (!cancelled) setCourses(result.items);
      })
      .catch(() => {
        if (!cancelled) setCourses([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      // 先让出一次微任务：避免在 effect 中同步 setState（react-hooks/set-state-in-effect）
      await Promise.resolve();
      if (cancelled) return;
      setStatus("loading");
      try {
        const result = await fetchRanking({ period, course_id: courseId });
        if (cancelled) return;
        setRows(result.items);
        setStatus("ready");
      } catch {
        if (!cancelled) setStatus("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [period, courseId, reloadToken]);

  // 切换条件写进 URL，返回与分享可回填（需求文档 §3.2）
  useEffect(() => {
    const params = new URLSearchParams();
    if (period !== DEFAULT_PERIOD) params.set("period", period);
    if (courseId) params.set("course_id", String(courseId));
    const query = params.toString();
    window.history.replaceState(null, "", query ? `/rankings?${query}` : "/rankings");
  }, [period, courseId]);

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-[22px] font-semibold text-ink">排行榜</h1>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1 rounded-md border border-line bg-canvas p-0.5">
            {RANK_PERIODS.map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setPeriod(value)}
                aria-pressed={period === value}
                className={`co-focusable cursor-pointer rounded-sm px-3 py-1.5 text-[13px] font-medium transition-colors duration-150 ease-standard ${
                  period === value
                    ? "bg-brand-soft text-brand-strong"
                    : "text-ink-muted hover:bg-panel"
                }`}
              >
                {RANK_PERIOD_LABEL[value]}
              </button>
            ))}
          </div>

          <label className="flex items-center gap-2 text-[13px] text-ink-muted">
            课程榜
            <select
              value={courseId ?? ""}
              onChange={(event) =>
                setCourseId(event.target.value ? Number(event.target.value) : undefined)
              }
              className="co-focusable h-9 rounded-md border border-line bg-canvas px-2 text-[13px] text-ink transition-colors duration-150 ease-standard hover:border-ink-subtle"
            >
              <option value="">全部课程</option>
              {courses.map((course) => (
                <option key={course.id} value={course.id}>
                  {course.name}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      {status === "loading" ? <LoadingSkeleton variant="list" count={5} /> : null}

      {status === "error" ? (
        <ErrorState
          message="榜单加载失败，请检查网络后重试。"
          onRetry={() => setReloadToken((token) => token + 1)}
        />
      ) : null}

      {status === "ready" && rows.length === 0 ? (
        <EmptyState
          title="该范围内暂无积分记录"
          description="换个榜单周期或课程再看看。"
          actionLabel="看总榜"
          onAction={() => {
            setPeriod(DEFAULT_PERIOD);
            setCourseId(undefined);
          }}
        />
      ) : null}

      {status === "ready" && rows.length > 0 ? (
        <ol className="flex flex-col gap-2">
          {rows.map((row, index) => (
            <li
              key={row.user_id}
              className="flex items-center gap-3 rounded-lg border border-line bg-canvas px-4 py-3"
            >
              <span className="w-6 shrink-0 text-center text-[13px] font-semibold text-ink-subtle">
                {index + 1}
              </span>
              <Link
                href={`/users/${row.user_id}`}
                className="co-focusable min-w-0 flex-1 truncate text-[14px] text-ink hover:text-brand"
              >
                {row.username}
              </Link>
              <span className="shrink-0 text-[13px] text-ink-muted">{row.score} 分</span>
            </li>
          ))}
        </ol>
      ) : null}
    </section>
  );
}
