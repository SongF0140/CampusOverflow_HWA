"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { fetchCourseNameMap } from "@/api/courses";
import { StatusBadge, TagChip } from "@/shared/components";
import { QUESTION_STATUS } from "@/shared/constants/domain";
import type { QuestionListItem } from "@/shared/types/question";
import { formatRelativeTime } from "@/shared/utils/format";

/**
 * 问题条目只有 course_id（后端暂无 course_name）：复用课程名映射。
 * 映射未就绪时返回 null（先不渲染），避免先闪一下「课程 #id」再变真名。
 */
function useCourseName(courseId: number): string | null {
  const [name, setName] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    let alive = true;
    void fetchCourseNameMap().then((map) => {
      if (alive) setName(map[courseId] ?? null); // null = 映射已就绪但没有这门课
    });
    return () => {
      alive = false;
    };
  }, [courseId]);

  if (name === undefined) return null;
  return name ?? `课程 #${courseId}`;
}

export function QuestionCard({ question }: { question: QuestionListItem }) {
  const resolved = question.status === QUESTION_STATUS.resolved || question.has_accepted;
  const courseName = useCourseName(question.course_id);

  return (
    <article className="group relative min-h-[64px] rounded-lg border border-line bg-canvas p-5 transition-colors duration-150 ease-standard hover:border-brand-line">
      {/* 整卡可点：透明覆盖链接（accessible name = 标题）；卡内交互元素用 relative z-10 抬升 */}
      <Link
        href={`/questions/${question.id}`}
        aria-label={question.title}
        className="co-focusable absolute inset-0 rounded-lg"
      />

      <div className="flex items-start justify-between gap-4">
        <Link
          href={`/questions/${question.id}`}
          className="co-focusable text-[16px] font-semibold leading-snug text-ink hover:text-brand"
        >
          {question.title}
        </Link>
        <StatusBadge tone={resolved ? "done" : "open"} />
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2 text-[12px] text-ink-subtle">
        {courseName ? (
          <>
            <span className="text-ink-muted">{courseName}</span>
            <span aria-hidden="true">·</span>
          </>
        ) : null}
        <span>{question.author}</span>
        <span aria-hidden="true">·</span>
        <span>{formatRelativeTime(question.created_at)}</span>
      </div>

      {question.tags.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {question.tags.map((tag) => (
            <Link key={tag.id} href={`/tags/${tag.id}`} className="relative z-10 rounded-full">
              <TagChip label={tag.name} />
            </Link>
          ))}
        </div>
      ) : null}

      <dl className="mt-3 flex flex-wrap items-center gap-5 text-[12px] text-ink-muted">
        <div className="flex items-center gap-1">
          <dt className="sr-only">票数</dt>
          <dd aria-hidden="true" className="text-ink-subtle">
            ▲
          </dd>
          <dd>{question.vote_score}</dd>
        </div>
        <div className="flex items-center gap-1">
          <dt className="sr-only">回答数</dt>
          <dd aria-hidden="true" className="text-ink-subtle">
            💬
          </dd>
          <dd>{question.answer_count}</dd>
        </div>
        <div className="flex items-center gap-1">
          <dt className="sr-only">浏览数</dt>
          <dd aria-hidden="true" className="text-ink-subtle">
            👁
          </dd>
          <dd>{question.view_count}</dd>
        </div>
        <div className="flex items-center gap-1">
          <dt className="sr-only">课程</dt>
          <dd>{courseName ?? `课程 ${question.course_id}`}</dd>
        </div>
      </dl>

      <div className="relative z-10 mt-3 flex items-center gap-2 text-[12px] text-ink-subtle">
        {authorId ? (
          <UserLine userId={authorId} nickname={question.author} role={authorRole} size="sm" />
        ) : (
          <span className="inline-flex items-center gap-1.5">
            <Avatar name={question.author} size="sm" />
            <span className="font-medium text-ink">{question.author}</span>
          </span>
        )}
        <span aria-hidden="true">·</span>
        <time dateTime={question.created_at}>{timeAgo(question.created_at)}</time>
      </div>
    </article>
  );
}
