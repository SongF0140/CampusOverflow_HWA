"use client";

import { useEffect, useState } from "react";

import { fetchMyCourses } from "@/api/courses";
import { QuestionList } from "@/features/questions/QuestionList";
import { EmptyState, ErrorState, LoadingSkeleton } from "@/shared/components";
import { useSessionStore } from "@/shared/stores/session-store";
import type { CourseListItem } from "@/shared/types/course";

type LoadStatus = "loading" | "ready" | "error";

/**
 * 优质内容认证（P-T05）：先选本人任教的课程，再看该课程的问答列表；
 * 认证动作在问题详情页的回答上完成（后端 POST/DELETE /api/answers/{id}/certify）。
 */
export function TeacherCertifyView() {
  const username = useSessionStore((state) => state.me?.username);
  const [courses, setCourses] = useState<CourseListItem[]>([]);
  const [status, setStatus] = useState<LoadStatus>("loading");
  const [reloadToken, setReloadToken] = useState(0);
  const [selectedId, setSelectedId] = useState<number | null>(null);

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
    return <LoadingSkeleton variant="detail" count={2} />;
  }

  if (status === "error") {
    return (
      <ErrorState
        message="课程列表加载失败，请检查网络后重试。"
        onRetry={() => setReloadToken((token) => token + 1)}
      />
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-[22px] font-semibold text-ink">优质内容认证</h1>
        <p className="mt-2 text-[13px] leading-relaxed text-ink-muted">
          选择你任教的课程 → 打开一道问题 → 在回答上点「认证优质内容」。
          认证只影响展示（会打上「优质内容」标记），<span className="text-ink">不影响采纳与问题状态</span>。
        </p>
      </div>

      {courses.length === 0 ? (
        <EmptyState
          title="还没有你负责的课程"
          description="只有你任教课程里的回答才能被你认证。"
        />
      ) : (
        <>
          <ul className="flex flex-wrap gap-2">
            {courses.map((course) => (
              <li key={course.id}>
                <button
                  type="button"
                  onClick={() => setSelectedId(course.id)}
                  aria-pressed={selectedId === course.id}
                  className={`co-focusable min-h-[40px] cursor-pointer rounded-md border px-3 py-2 text-[13px] font-medium transition-colors duration-150 ease-standard ${
                    selectedId === course.id
                      ? "border-brand bg-brand-soft text-brand-strong"
                      : "border-line bg-canvas text-ink-muted hover:bg-panel"
                  }`}
                >
                  {course.name}（{course.code}）
                </button>
              </li>
            ))}
          </ul>

          {selectedId ? (
            <QuestionList
              courseId={selectedId}
              title="课程问答"
              headingLevel="h2"
              basePath="/teacher/certify"
            />
          ) : (
            <p className="rounded-lg border border-line bg-canvas px-5 py-6 text-[13px] text-ink-muted">
              先选择一门课程，下面会显示它的问答列表。
            </p>
          )}
        </>
      )}
    </div>
  );
}
