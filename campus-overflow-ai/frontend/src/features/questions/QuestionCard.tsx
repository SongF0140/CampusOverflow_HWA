"use client";

import Link from "next/link";
import { StatusBadge, TagChip } from "@/shared/components";
import { QUESTION_STATUS } from "@/shared/constants/domain";
import type { QuestionListItem } from "@/shared/types/question";
import { formatRelativeTime } from "@/shared/utils/format";

export function QuestionCard({
  question,
  courseName: courseNameProp,
}: {
  question: QuestionListItem;
  courseName?: string | null;
}) {
  const resolved = question.status === QUESTION_STATUS.resolved || question.has_accepted;
  const courseName = question.course_name || courseNameProp || `课程 #${question.course_id}`;

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
          {/* 标签链接带 co-focusable：键盘焦点可见（规则 7） */}
          {question.tags.map((tag) => (
            <Link
              key={tag.id}
              href={`/tags/${tag.id}`}
              className="co-focusable relative z-10 rounded-full"
            >
              <TagChip label={tag.name} />
            </Link>
          ))}
        </div>
      ) : null}

      <dl className="mt-3 flex items-center gap-5 text-[12px] text-ink-muted">
        <div className="flex items-center gap-1">
          <dt className="sr-only">票数</dt>
          <dd>{question.vote_score} 票</dd>
        </div>
        <div className="flex items-center gap-1">
          <dt className="sr-only">回答数</dt>
          <dd>{question.answer_count} 回答</dd>
        </div>
        <div className="flex items-center gap-1">
          <dt className="sr-only">浏览数</dt>
          <dd>{question.view_count} 浏览</dd>
        </div>
      </dl>
    </article>
  );
}
