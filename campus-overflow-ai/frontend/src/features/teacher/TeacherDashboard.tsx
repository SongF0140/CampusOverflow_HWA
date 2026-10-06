"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { fetchMyCourses } from "@/api/courses";
import { EmptyState, ErrorState, LoadingSkeleton } from "@/shared/components";
import { useSessionStore } from "@/shared/stores/session-store";
import type { CourseListItem } from "@/shared/types/course";

type LoadStatus = "loading" | "ready" | "error";

const entryClass =
  "co-focusable flex min-h-[44px] items-center rounded-md border border-line bg-canvas px-4 py-2.5 text-[14px] text-ink transition-colors duration-150 ease-standard hover:border-brand-line hover:bg-panel";

function StatCard({ label, value, unit }: { label: string; value: number; unit: string }) {
  return (
    <div className="rounded-lg border border-line bg-canvas px-5 py-4">
      <p className="text-[12px] text-ink-muted">{label}</p>
      <p className="mt-1 text-[24px] font-semibold text-ink">
        {value}
        <span className="ml-1 text-[13px] font-normal text-ink-subtle">{unit}</span>
      </p>
    </div>
  );
}

/** 教师工作台（P-T01）：指标卡 + 待办入口，数据全部来自课程列表，不需要额外接口 */
export function TeacherDashboard() {
  const router = useRouter();
  const username = useSessionStore((state) => state.user?.username);
  const [courses, setCourses] = useState<CourseListItem[]>([]);
  const [status, setStatus] = useState<LoadStatus>("loading");
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    if (!username) return;
    let cancelled = false;
    void (async () => {
      // 先让出一次微任务：避免在 effect 中同步 setState（react-hooks/set-state-in-effect）
      await Promise.resolve();
      if (cancelled) return;
      setStatus("loading");
      try {
        const mine = await fetchMyCourses(username);
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

  if (status === "loading") {
    return <LoadingSkeleton variant="detail" count={3} />;
  }

  if (status === "error") {
    return (
      <ErrorState
        message="工作台数据加载失败，请检查网络后重试。"
        onRetry={() => setReloadToken((token) => token + 1)}
      />
    );
  }

  const questionTotal = courses.reduce((sum, course) => sum + course.question_count, 0);
  const memberTotal = courses.reduce((sum, course) => sum + course.member_count, 0);

  return (
    <div className="flex flex-col gap-5">
      <h1 className="text-[22px] font-semibold text-ink">教师工作台</h1>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard label="我教的课程" value={courses.length} unit="门" />
        <StatCard label="课程内问题" value={questionTotal} unit="条" />
        <StatCard label="课程成员" value={memberTotal} unit="人" />
      </div>

      {courses.length === 0 ? (
        <EmptyState
          title="还没有你负责的课程"
          description="新建一门课程后，就可以管理课程问题、成员与标签。"
          actionLabel="去新建课程"
          onAction={() => router.push("/teacher/courses")}
        />
      ) : (
        <section className="rounded-lg border border-line bg-canvas p-5">
          <h2 className="text-[14px] font-semibold text-ink">待办与入口</h2>
          <ul className="mt-3 flex flex-col gap-2">
            <li>
              <Link href="/teacher/courses" className={`${entryClass} justify-between`}>
                <span>我的课程</span>
                <span className="text-[13px] text-ink-subtle">共 {courses.length} 门</span>
              </Link>
            </li>
            <li>
              <Link href="/teacher/certify" className={`${entryClass} justify-between`}>
                <span>优质内容认证</span>
                <span className="text-[13px] text-ink-subtle">认证本人任教课程的回答</span>
              </Link>
            </li>
            <li>
              <Link href="/teacher/moderation" className={`${entryClass} justify-between`}>
                <span>工单处理</span>
                <span className="text-[13px] text-ink-subtle">随第二阶段上线</span>
              </Link>
            </li>
          </ul>
        </section>
      )}
    </div>
  );
}
