"use client";

import Link from "next/link";
import { useState } from "react";

import { fetchCourseDetail, updateCourse } from "@/api/courses";
import {
  Button,
  ErrorState,
  ForbiddenNotice,
  LoadingSkeleton,
  TabNav,
  Toast,
  type ToastTone,
} from "@/shared/components";
import { USER_ROLE } from "@/shared/constants/domain";
import { toErrorMessage, useAsyncData } from "@/shared/hooks/useAsyncData";
import { useSessionStore } from "@/shared/stores/session-store";
import type { CourseDetail } from "@/shared/types/course";

import { CourseFormModal, type CourseFormValues } from "./CourseFormModal";
import {
  MembersTab,
  QuestionsTab,
  SettingsTab,
  TagsTab,
  type ShowToast,
} from "./CourseManageParts";

// 课程管理详情（页面控件级设计说明 §3.3）：头卡操作行（编辑/跨端查看/删除）+ 四个 Tab
// 权限：仅负责教师与管理员（后端 ensure_can_manage 二次校验）
const TABS = [
  { key: "questions", label: "问题" },
  { key: "members", label: "成员" },
  { key: "tags", label: "标签" },
  { key: "settings", label: "设置" },
];

export function CourseManageView({ courseId }: { courseId: number }) {
  const role = useSessionStore((state) => state.me?.role);
  const [tab, setTab] = useState("questions");
  const [toast, setToast] = useState<{ tone: ToastTone; message: string } | null>(null);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const detailState = useAsyncData(() => fetchCourseDetail(courseId), [courseId]);
  const detail: CourseDetail | null = detailState.data;
  const showToast: ShowToast = (tone, message) => setToast({ tone, message });

  async function handleUpdate(values: CourseFormValues): Promise<void> {
    setIsSaving(true);
    setSaveError(null);
    try {
      // 后端 PATCH 只接受 name/description/semester（编码不可改）
      await updateCourse(courseId, {
        name: values.name,
        description: values.description,
        semester: values.semester,
      });
      setIsEditOpen(false);
      showToast("success", "课程已更新");
      detailState.reload();
    } catch (caught) {
      setSaveError(toErrorMessage(caught));
    } finally {
      setIsSaving(false);
    }
  }

  if (detailState.isLoading) return <LoadingSkeleton variant="detail" count={3} />;

  if (detailState.error !== null || !detail) {
    return (
      <ErrorState message={detailState.error ?? "课程不存在"} onRetry={detailState.reload} />
    );
  }

  const canManage = role === USER_ROLE.admin || detail.is_owner === true;
  if (!canManage) return <ForbiddenNotice />;

  return (
    <div className="flex flex-col gap-5">
      {toast ? <Toast tone={toast.tone} message={toast.message} onClose={() => setToast(null)} /> : null}

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
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="ghost" onClick={() => setIsEditOpen(true)}>
            编辑课程
          </Button>
          <Link
            href={`/courses/${courseId}`}
            target="_blank"
            rel="noreferrer"
            className="co-focusable inline-flex h-9 items-center justify-center rounded-md border border-line bg-canvas px-3 text-[13px] font-medium text-ink transition-colors duration-150 ease-standard hover:bg-panel"
          >
            跨端查看
          </Link>
          {/* TODO(接口差异)：后端无 DELETE /api/courses/{id} → 禁用并说明，不做假成功 */}
          <Button variant="danger" disabled title="删除课程接口待后端提供，暂不可用">
            删除课程
          </Button>
        </div>
      </div>

      <TabNav tabs={TABS} active={tab} onChange={setTab} />

      {tab === "questions" ? <QuestionsTab courseId={courseId} /> : null}
      {tab === "members" ? <MembersTab courseId={courseId} showToast={showToast} /> : null}
      {tab === "tags" ? <TagsTab tags={detail.aggregates.tags} showToast={showToast} /> : null}
      {tab === "settings" ? <SettingsTab detail={detail} /> : null}

      <CourseFormModal
        open={isEditOpen}
        title="编辑课程"
        initial={{
          name: detail.name,
          code: detail.code,
          description: detail.description,
          semester: detail.semester,
        }}
        lockCode
        submitting={isSaving}
        submitError={saveError}
        onSubmit={handleUpdate}
        onClose={() => setIsEditOpen(false)}
      />
    </div>
  );
}
