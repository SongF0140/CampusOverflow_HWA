"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { fetchCourseDetail } from "@/api/courses";
import { QuestionList } from "@/features/questions/QuestionList";
import { ErrorState, ForbiddenNotice, LoadingSkeleton, TagChip } from "@/shared/components";
import { USER_ROLE } from "@/shared/constants/domain";
import { useSessionStore } from "@/shared/stores/session-store";
import type { CourseDetail } from "@/shared/types/course";
import type { QuestionSort } from "@/shared/types/question";

import { CourseForm } from "./CourseForm";
import { CourseMembersTab } from "./CourseMembersTab";

type LoadStatus = "loading" | "ready" | "error";

const TABS = [
  { id: "questions", label: "问题" },
  { id: "members", label: "成员" },
  { id: "tags", label: "标签" },
  { id: "settings", label: "设置" },
] as const;
type TabId = (typeof TABS)[number]["id"];

/**
 * 课程管理详情（P-T03）：Tab＝问题 / 成员 / 标签 / 设置 + 跨端查看。
 * 管理权限与后端一致（courses/domain.ensure_can_manage）：仅负责教师与管理员。
 */
export function CourseManageView({
  courseId,
  initialKeyword = "",
  initialSort = "latest",
  initialUnresolved = false,
}: {
  courseId: number;
  initialKeyword?: string;
  initialSort?: QuestionSort;
  initialUnresolved?: boolean;
}) {
  const role = useSessionStore((state) => state.user?.role);
  const username = useSessionStore((state) => state.user?.username);
  const [detail, setDetail] = useState<CourseDetail | null>(null);
  const [status, setStatus] = useState<LoadStatus>("loading");
  const [reloadToken, setReloadToken] = useState(0);
  const [tab, setTab] = useState<TabId>("questions");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      // 先让出一次微任务：避免在 effect 中同步 setState（react-hooks/set-state-in-effect）
      await Promise.resolve();
      if (cancelled) return;
      setStatus("loading");
      try {
        const result = await fetchCourseDetail(courseId);
        if (cancelled) return;
        setDetail(result);
        setStatus("ready");
      } catch {
        if (!cancelled) setStatus("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [courseId, reloadToken]);

  if (status === "loading") {
    return <LoadingSkeleton variant="detail" count={3} />;
  }

  if (status === "error" || !detail) {
    return (
      <ErrorState
        message="课程信息加载失败，请检查网络后重试。"
        onRetry={() => setReloadToken((token) => token + 1)}
      />
    );
  }

  // 课程详情响应暂无 is_owner（后端缺口已登记），先用负责教师名与当前用户名比对
  const canManage = role === USER_ROLE.admin || detail.teacher_name === username;
  if (!canManage) return <ForbiddenNotice />;

  return (
    <div className="flex flex-col gap-5">
      <nav className="text-[12px] text-ink-subtle" aria-label="面包屑">
        <Link href="/teacher/courses" className="co-focusable hover:text-brand">
          我的课程
        </Link>
        <span className="mx-1.5" aria-hidden="true">
          /
        </span>
        <span>{detail.name}</span>
      </nav>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-[22px] font-semibold text-ink">{detail.name}</h1>
          <p className="mt-2 flex flex-wrap items-center gap-2 text-[12px] text-ink-subtle">
            <span className="text-ink-muted">{detail.code}</span>
            <span aria-hidden="true">·</span>
            <span>授课：{detail.teacher_name}</span>
            {detail.semester ? (
              <>
                <span aria-hidden="true">·</span>
                <span>{detail.semester}</span>
              </>
            ) : null}
          </p>
        </div>
        <Link
          href={`/courses/${courseId}`}
          className="co-focusable inline-flex min-h-[40px] items-center rounded-md border border-line px-3 py-1.5 text-[13px] font-medium text-ink transition-colors duration-150 ease-standard hover:bg-panel"
        >
          跨端查看（学生端课程页）
        </Link>
      </div>

      <div className="flex flex-wrap items-center gap-1 rounded-md border border-line bg-canvas p-0.5">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => {
              setTab(item.id);
              setSaved(false);
            }}
            aria-pressed={tab === item.id}
            className={`co-focusable min-h-[40px] cursor-pointer rounded-sm px-3 py-2 text-[13px] font-medium transition-colors duration-150 ease-standard ${
              tab === item.id ? "bg-brand-soft text-brand-strong" : "text-ink-muted hover:bg-panel"
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {tab === "questions" ? (
        <QuestionList
          courseId={courseId}
          initialKeyword={initialKeyword}
          initialSort={initialSort}
          initialUnresolved={initialUnresolved}
          title="课程问答"
          headingLevel="h2"
          basePath={`/teacher/courses/${courseId}`}
        />
      ) : null}

      {tab === "members" ? <CourseMembersTab courseId={courseId} /> : null}

      {tab === "tags" ? (
        detail.aggregates.tags.length === 0 ? (
          <p className="rounded-lg border border-line bg-canvas px-5 py-6 text-[13px] text-ink-muted">
            暂无标签：标签由该课程下问题的绑定聚合而来。
          </p>
        ) : (
          <div className="rounded-lg border border-line bg-canvas p-5">
            <h2 className="text-[14px] font-semibold text-ink">课程标签</h2>
            <p className="mt-1 text-[12px] text-ink-subtle">由该课程下问题绑定的标签聚合而来</p>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {detail.aggregates.tags.map((tag) => (
                <Link key={tag.id} href={`/tags/${tag.id}`} className="co-focusable">
                  <TagChip label={`${tag.name}（${tag.question_count}）`} />
                </Link>
              ))}
            </div>
          </div>
        )
      ) : null}

      {tab === "settings" ? (
        <div className="flex flex-col gap-3">
          {saved ? (
            <p className="rounded-md border border-success-soft bg-success-soft px-3 py-2 text-[13px] text-success-ink">
              课程信息已更新。
            </p>
          ) : null}
          <CourseForm
            course={{
              id: detail.id,
              name: detail.name,
              code: detail.code,
              description: detail.description,
              semester: detail.semester,
            }}
            onSaved={() => {
              setSaved(true);
              setReloadToken((token) => token + 1);
            }}
            onCancel={() => setTab("questions")}
          />
        </div>
      ) : null}
    </div>
  );
}
