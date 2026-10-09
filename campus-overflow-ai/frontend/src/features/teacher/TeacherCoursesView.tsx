"use client";

import { useState } from "react";
import Link from "next/link";

import { createCourse, listCourses } from "@/api/courses";
import { Button, EmptyState, ErrorState, LoadingSkeleton, Toast } from "@/shared/components";
import { toErrorMessage, useAsyncData } from "@/shared/hooks/useAsyncData";
import type { Course } from "@/shared/types/course";

import { CourseFormModal, type CourseFormValues } from "./CourseFormModal";

const COURSE_PAGE_SIZE = 100;

const MANAGE_LINK_CLASS =
  "co-focusable inline-flex h-9 items-center justify-center rounded-md bg-brand px-3 text-[13px] font-medium text-white transition-colors duration-150 ease-standard hover:bg-brand-strong";

// 我的课程（页面控件级设计说明 §3.2）：新建课程 Modal + 课程卡列表 + 三态
// 登录与教师角色守卫由 src/proxy.ts 服务端完成
export function TeacherCoursesView() {
  // reloadToken 进 useAsyncData 依赖：新建成功后递增以重拉列表
  const [reloadToken, setReloadToken] = useState(0);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [successToast, setSuccessToast] = useState<string | null>(null);

  const listState = useAsyncData(
    () => listCourses({ page: 1, page_size: COURSE_PAGE_SIZE }),
    [reloadToken],
  );
  // TODO(接口差异)：discovery 版 GET /courses 无"仅本人任教"过滤参数，暂渲染全部课程；
  // 且列表条目无 semester/status 字段，卡片不渲染学期与状态徽标（后端补齐后恢复）
  const courses: Course[] = listState.data?.items ?? [];
  const isReady = !listState.isLoading && listState.error === null;

  async function handleCreate(values: CourseFormValues): Promise<void> {
    setIsSubmitting(true);
    setSubmitError(null);
    try {
      await createCourse(values);
      setIsModalOpen(false);
      setSuccessToast("课程已创建");
      setReloadToken((token) => token + 1);
    } catch (caught) {
      // 失败保留 Modal 与已填内容，错误经 submitError 行内展示
      setSubmitError(toErrorMessage(caught));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {successToast ? (
        <Toast tone="success" message={successToast} onClose={() => setSuccessToast(null)} />
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-[22px] font-semibold text-ink">我的课程</h2>
        <Button onClick={() => setIsModalOpen(true)}>＋ 新建课程</Button>
      </div>

      {listState.isLoading ? <LoadingSkeleton variant="list" count={5} /> : null}

      {listState.error !== null ? (
        <ErrorState message={listState.error} onRetry={listState.reload} />
      ) : null}

      {isReady && courses.length === 0 ? (
        <EmptyState title="还没有课程" description="点击右上角新建，创建后即可管理问题与成员。" />
      ) : null}

      {isReady && courses.length > 0 ? (
        <ul className="grid grid-cols-1 gap-4 md:grid-cols-2 min-[1025px]:grid-cols-3">
          {courses.map((course) => (
            <li key={course.id}>
              <article className="flex h-full flex-col gap-2.5 rounded-lg border border-line bg-canvas p-5 transition-colors duration-150 ease-standard hover:border-brand-line">
                <div className="flex items-start justify-between gap-3">
                  <h3 className="text-[16px] font-semibold leading-snug text-ink">{course.name}</h3>
                  <span className="shrink-0 rounded-full bg-panel px-2 py-0.5 text-[12px] text-ink-muted">
                    {course.code}
                  </span>
                </div>
                <p className="text-[13px] text-ink-muted">授课教师 · {course.teacher_name || "待定"}</p>
                <p className="text-[12px] text-ink-subtle">
                  {course.member_count} 名成员 · {course.question_count} 个问题
                </p>
                <div className="mt-auto pt-1">
                  <Link href={`/teacher/courses/${course.id}`} className={MANAGE_LINK_CLASS}>
                    管理
                  </Link>
                </div>
              </article>
            </li>
          ))}
        </ul>
      ) : null}

      <CourseFormModal
        open={isModalOpen}
        title="新建课程"
        submitting={isSubmitting}
        submitError={submitError}
        onSubmit={handleCreate}
        onClose={() => setIsModalOpen(false)}
      />
    </div>
  );
}
