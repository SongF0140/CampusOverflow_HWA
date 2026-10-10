import Link from "next/link";

import type { CourseListItem } from "@/shared/types/course";

/** 课程卡（学生端接口文档 §2）：列表条目只有名称/编码/教师/成员数/问题数，没有简介 */
export function CourseCard({ course }: { course: CourseListItem }) {
  return (
    <article className="rounded-lg border border-line bg-canvas p-5 transition-colors duration-150 ease-standard hover:border-brand-line">
      <Link
        href={`/courses/${course.id}`}
        className="co-focusable text-[16px] font-semibold leading-snug text-ink hover:text-brand"
      >
        {course.name}
      </Link>

      <div className="mt-2 flex flex-wrap items-center gap-2 text-[12px] text-ink-subtle">
        <span className="text-ink-muted">{course.code}</span>
        <span aria-hidden="true">·</span>
        <span>授课：{course.teacher_name}</span>
      </div>

      <dl className="mt-3 flex items-center gap-5 text-[12px] text-ink-muted">
        <div className="flex items-center gap-1">
          <dt className="sr-only">成员数</dt>
          <dd>{course.member_count} 成员</dd>
        </div>
        <div className="flex items-center gap-1">
          <dt className="sr-only">问题数</dt>
          <dd>{course.question_count} 问题</dd>
        </div>
      </dl>
    </article>
  );
}
