"use client";

import { useState } from "react";
import Link from "next/link";

import { listCourses, updateCourse } from "@/api/courses";
import { CourseFormModal, type CourseFormValues } from "@/features/teacher/CourseFormModal";
import {
  Button,
  EmptyState,
  ErrorState,
  Input,
  LoadingSkeleton,
  Pagination,
  Select,
  Toast,
  type SelectOption,
  type ToastTone,
} from "@/shared/components";
import { toErrorMessage, useAsyncData } from "@/shared/hooks/useAsyncData";
import type { Course } from "@/shared/types/course";

const PAGE_SIZE = 10;

// 学期筛选为服务端参数（discovery GET /courses 支持 semester）；all=全部不传参
const SEMESTER_FILTER_OPTIONS: SelectOption[] = [
  { value: "all", label: "全部" },
  { value: "2025秋", label: "2025 秋" },
  { value: "2026春", label: "2026 春" },
  { value: "2026秋", label: "2026 秋" },
  { value: "2027春", label: "2027 春" },
  { value: "2027秋", label: "2027 秋" },
];

// 课程表（§4.3）：名称 · 课程编码 · 授课教师 · 学期 · 状态 · 问题数 · 操作
function AdminCoursesTable({
  courses,
  onEdit,
}: {
  courses: Course[];
  onEdit: (course: Course) => void;
}) {
  return (
    <div className="overflow-x-auto rounded-lg border border-line bg-canvas">
      <table className="w-full border-collapse text-left">
        <thead>
          <tr className="border-b border-line text-[12px] text-ink-subtle">
            <th scope="col" className="py-3 pl-5 pr-4 font-medium">名称</th>
            <th scope="col" className="py-3 pr-4 font-medium">课程编码</th>
            <th scope="col" className="py-3 pr-4 font-medium">授课教师</th>
            <th scope="col" className="py-3 pr-4 font-medium">学期</th>
            <th scope="col" className="py-3 pr-4 font-medium">状态</th>
            <th scope="col" className="py-3 pr-4 font-medium">问题数</th>
            <th scope="col" className="py-3 pr-4 font-medium">操作</th>
          </tr>
        </thead>
        <tbody>
          {courses.map((course) => (
            <tr key={course.id} className="border-b border-line last:border-b-0">
              <td className="py-3 pl-5 pr-4">
                {/* 名称 → /courses/[id] 公开页（跨端查看） */}
                <Link
                  href={`/courses/${course.id}`}
                  className="co-focusable font-medium text-brand hover:underline"
                >
                  {course.name}
                </Link>
              </td>
              <td className="py-3 pr-4 text-[13px] text-ink-muted">{course.code}</td>
              <td className="py-3 pr-4 text-[13px] text-ink-muted">
                {course.teacher_name || "待定"}
              </td>
              {/* TODO(接口差异)：discovery GET /courses 条目无 semester 字段 → 学期列以"—"占位 */}
              <td className="py-3 pr-4 text-[13px] text-ink-subtle">—</td>
              {/* TODO(接口差异)：列表条目无 status 字段 → 状态列以"—"占位 */}
              <td className="py-3 pr-4 text-[13px] text-ink-subtle">—</td>
              <td className="py-3 pr-4 text-[13px] text-ink-muted">{course.question_count}</td>
              <td className="py-3 pr-4">
                <Button variant="ghost" onClick={() => onEdit(course)}>
                  编辑
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// 课程管理（页面控件级设计说明 §4.3）：搜索/学期筛选 + 课程表 + 编辑 Modal（复用教师端表单）
// 登录与管理员守卫由 src/proxy.ts 服务端完成
export function AdminCoursesView() {
  const [page, setPage] = useState(1);
  const [reloadToken, setReloadToken] = useState(0);
  const [keyword, setKeyword] = useState("");
  // appliedKeyword：回车/按钮触发后才生效的搜索词，与输入框即时值分离
  const [appliedKeyword, setAppliedKeyword] = useState("");
  const [semester, setSemester] = useState("all");
  const [editTarget, setEditTarget] = useState<Course | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ tone: ToastTone; message: string } | null>(null);

  const listState = useAsyncData(
    () =>
      listCourses({
        page,
        page_size: PAGE_SIZE,
        keyword: appliedKeyword === "" ? undefined : appliedKeyword,
        semester: semester === "all" ? undefined : semester,
      }),
    [page, appliedKeyword, semester, reloadToken],
  );
  const courses: Course[] = listState.data?.items ?? [];
  const isReady = !listState.isLoading && listState.error === null;

  // 搜索触发（回车或按钮）：条件变更后回到第 1 页（服务端筛选）
  function handleSearch() {
    setAppliedKeyword(keyword.trim());
    setPage(1);
  }

  async function handleEditSubmit(values: CourseFormValues): Promise<void> {
    if (editTarget === null) return;
    setIsSubmitting(true);
    setSubmitError(null);
    try {
      // TODO(接口差异)：Course 列表条目无 semester/description 字段 → 无法回填已有值。
      // 学期未改动（仍为预填 null）时不传 semester，避免 PATCH null 清空后端已有学期；
      // description 一律不传（传 null 会清空已有简介）；code 后端 CourseUpdateRequest 不收。
      const payload =
        values.semester === null
          ? { name: values.name }
          : { name: values.name, semester: values.semester };
      await updateCourse(editTarget.id, payload);
      setEditTarget(null);
      setToast({ tone: "success", message: "课程已更新" });
      setReloadToken((token) => token + 1);
    } catch (caught) {
      // 失败保留 Modal 与已填内容，错误经 Modal 行内提示
      setSubmitError(toErrorMessage(caught));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {toast ? (
        <Toast tone={toast.tone} message={toast.message} onClose={() => setToast(null)} />
      ) : null}

      <h2 className="text-[22px] font-semibold text-ink">课程管理</h2>

      <div className="flex flex-wrap items-end gap-3">
        <Input
          label="搜索课程"
          value={keyword}
          placeholder="课程名或课程编码"
          className="w-[240px]"
          onChange={(event) => setKeyword(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") handleSearch();
          }}
        />
        <Button onClick={handleSearch}>搜索</Button>
        <div className="w-[140px]">
          <Select
            label="学期"
            value={semester}
            options={SEMESTER_FILTER_OPTIONS}
            onChange={(event) => {
              setSemester(event.target.value);
              setPage(1);
            }}
          />
        </div>
      </div>

      {listState.isLoading ? <LoadingSkeleton variant="list" count={5} /> : null}

      {listState.error !== null ? (
        <ErrorState message={listState.error} onRetry={listState.reload} />
      ) : null}

      {isReady && courses.length === 0 ? (
        <EmptyState
          title="暂无课程"
          description="平台上还没有课程，或当前筛选条件没有匹配结果。"
        />
      ) : null}

      {isReady && courses.length > 0 ? (
        <AdminCoursesTable
          courses={courses}
          onEdit={(course) => {
            setSubmitError(null);
            setEditTarget(course);
          }}
        />
      ) : null}

      {listState.data !== null && listState.data.total > PAGE_SIZE ? (
        <div className="flex justify-center">
          <Pagination
            page={page}
            pageSize={PAGE_SIZE}
            total={listState.data.total}
            onChange={(next) => setPage(next)}
          />
        </div>
      ) : null}

      <CourseFormModal
        open={editTarget !== null}
        title="编辑课程"
        lockCode
        submitting={isSubmitting}
        submitError={submitError}
        initial={
          editTarget === null
            ? null
            : {
                name: editTarget.name,
                code: editTarget.code,
                // TODO(接口差异)：列表条目无 description/semester 字段 → 预填空值
                description: "",
                semester: null,
              }
        }
        onSubmit={(values) => void handleEditSubmit(values)}
        onClose={() => setEditTarget(null)}
      />
    </div>
  );
}
