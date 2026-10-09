"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { fetchMyCourses } from "@/api/courses";
import { EmptyState, ErrorState, LoadingSkeleton } from "@/shared/components";
import { USER_ROLE } from "@/shared/constants/domain";
import { useSessionStore } from "@/shared/stores/session-store";
import type { CourseListItem } from "@/shared/types/course";

import { CourseForm } from "./CourseForm";

type LoadStatus = "loading" | "ready" | "error";

/** 我的课程（P-T02）：列表 + 新建课程；点课程卡进入课程管理详情 */
export function TeacherCourseList() {
  const router = useRouter();
  const role = useSessionStore((state) => state.me?.role);
  const username = useSessionStore((state) => state.me?.username);
  const [courses, setCourses] = useState<CourseListItem[]>([]);
  const [status, setStatus] = useState<LoadStatus>("loading");
  const [reloadToken, setReloadToken] = useState(0);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!username) return;
    let cancelled = false;
    void (async () => {
      // 先让出一次微任务：避免在 effect 中同步 setState（react-hooks/set-state-in-effect）
      await Promise.resolve();
      if (cancelled) return;
      setStatus("loading");
      try {
        const mine = await fetchMyCourses();
        if (cancelled) return;
        setCourses(mine);
        setStatus("ready");
      } catch {
        if (!cancelled) setStatus("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [username, reloadToken]);

  const reload = useCallback(() => setReloadToken((token) => token + 1), []);
  // 后端 POST /api/courses 只允许教师角色（管理员也不行），越权入口不渲染
  const canCreate = role === USER_ROLE.teacher;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-[22px] font-semibold text-ink">我的课程</h1>
        {canCreate && !creating ? (
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="co-focusable cursor-pointer rounded-md bg-brand px-4 py-2 text-[14px] font-medium text-white transition-colors duration-150 ease-standard hover:bg-brand-strong"
          >
            ＋ 新建课程
          </button>
        ) : null}
      </div>

      {creating ? (
        <CourseForm
          onSaved={() => {
            setCreating(false);
            reload();
          }}
          onCancel={() => setCreating(false)}
        />
      ) : null}

      {status === "loading" ? <LoadingSkeleton variant="list" count={3} /> : null}

      {status === "error" ? (
        <ErrorState message="课程列表加载失败，请检查网络后重试。" onRetry={reload} />
      ) : null}

      {status === "ready" && courses.length === 0 ? (
        <EmptyState
          title={canCreate ? "还没有你负责的课程" : "「我的课程」只显示你任教的课程"}
          description={
            canCreate
              ? "新建一门课程后，就可以在这里管理它。"
              : "当前账号没有任教的课程（管理员/助教可在学生端课程列表查看全部课程）。"
          }
          actionLabel={canCreate ? "新建课程" : "查看全部课程"}
          onAction={canCreate ? () => setCreating(true) : () => router.push("/courses")}
        />
      ) : null}

      {status === "ready" && courses.length > 0 ? (
        <ul className="flex flex-col gap-3">
          {courses.map((course) => (
            <li key={course.id} className="rounded-lg border border-line bg-canvas p-5">
              <Link
                href={`/teacher/courses/${course.id}`}
                className="co-focusable text-[16px] font-semibold text-ink hover:text-brand"
              >
                {course.name}
              </Link>
              <p className="mt-2 flex flex-wrap items-center gap-2 text-[12px] text-ink-subtle">
                <span className="text-ink-muted">{course.code}</span>
                <span aria-hidden="true">·</span>
                <span>{course.member_count} 成员</span>
                <span aria-hidden="true">·</span>
                <span>{course.question_count} 问题</span>
              </p>
              <Link
                href={`/teacher/courses/${course.id}`}
                className="co-focusable mt-3 inline-flex min-h-[40px] items-center rounded-md border border-line px-3 py-1.5 text-[13px] font-medium text-ink transition-colors duration-150 ease-standard hover:bg-panel"
              >
                课程管理
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
