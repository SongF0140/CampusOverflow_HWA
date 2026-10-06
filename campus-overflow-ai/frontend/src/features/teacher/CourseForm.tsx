"use client";

import { useState, type FormEvent } from "react";

import { ApiError } from "@/api/client";
import { createCourse, updateCourse } from "@/api/courses";
import {
  COURSE_CODE_MAX_LEN,
  COURSE_DESC_MAX_LEN,
  COURSE_NAME_MAX_LEN,
  COURSE_SEMESTER_MAX_LEN,
} from "@/shared/constants/domain";

const inputClass =
  "co-focusable w-full rounded-md border border-line bg-canvas px-3 py-2 text-[14px] text-ink transition-colors duration-150 ease-standard placeholder:text-ink-subtle hover:border-ink-subtle focus:border-brand focus:ring-2 focus:ring-brand/20";

/**
 * 课程表单：新建（POST /api/courses）与编辑（PATCH /api/courses/{id}）共用。
 * 后端契约：新建接受 name/code/description/semester；编辑只接受 name/description/semester
 * （编码是课程标识，不可改），因此编辑态把编码显示为只读。
 */
export function CourseForm({
  course,
  onSaved,
  onCancel,
}: {
  // 只依赖后端 CourseUpdateRequest 允许的字段（编码不可改）
  course?: {
    id: number;
    name: string;
    code: string;
    description?: string | null;
    semester?: string | null;
  };
  onSaved: () => void;
  onCancel: () => void;
}) {
  const editing = Boolean(course);
  const [name, setName] = useState(course?.name ?? "");
  const [code, setCode] = useState(course?.code ?? "");
  const [description, setDescription] = useState(course?.description ?? "");
  const [semester, setSemester] = useState(course?.semester ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedName = name.trim();
    const trimmedCode = code.trim();

    if (!trimmedName) {
      setError("课程名不能为空");
      return;
    }
    if (trimmedName.length > COURSE_NAME_MAX_LEN) {
      setError(`课程名不能超过 ${COURSE_NAME_MAX_LEN} 字`);
      return;
    }
    if (!editing && !trimmedCode) {
      setError("课程编码不能为空");
      return;
    }
    if (!editing && trimmedCode.length > COURSE_CODE_MAX_LEN) {
      setError(`课程编码不能超过 ${COURSE_CODE_MAX_LEN} 字`);
      return;
    }
    if (description.trim().length > COURSE_DESC_MAX_LEN) {
      setError(`课程简介不能超过 ${COURSE_DESC_MAX_LEN} 字`);
      return;
    }
    if (semester.trim().length > COURSE_SEMESTER_MAX_LEN) {
      setError(`学期标识不能超过 ${COURSE_SEMESTER_MAX_LEN} 字`);
      return;
    }

    setPending(true);
    setError(null);
    try {
      // 可选字段留空就不传（后端 PATCH 语义：None = 不修改）
      const optional = {
        description: description.trim() || undefined,
        semester: semester.trim() || undefined,
      };
      if (course) {
        await updateCourse(course.id, { name: trimmedName, ...optional });
      } else {
        await createCourse({ name: trimmedName, code: trimmedCode, ...optional });
      }
      onSaved();
    } catch (caught) {
      // 后端提示是中文（如「课程编码已存在」），优先展示
      setError(caught instanceof ApiError ? caught.message : "保存失败，请稍后重试");
    } finally {
      setPending(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col gap-4 rounded-lg border border-line bg-canvas p-5"
    >
      <h2 className="text-[16px] font-semibold text-ink">{editing ? "编辑课程" : "新建课程"}</h2>

      <label className="flex flex-col gap-1.5">
        <span className="text-[13px] font-medium text-ink">
          课程名
          <span className="ml-2 text-[12px] text-ink-subtle">
            {name.length}/{COURSE_NAME_MAX_LEN}
          </span>
        </span>
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="例如：数据结构"
          className={`${inputClass} h-11`}
        />
      </label>

      {editing ? (
        <div className="flex flex-col gap-1.5">
          <span className="text-[13px] font-medium text-ink">课程编码</span>
          <p className="rounded-md border border-line bg-panel px-3 py-2 text-[14px] text-ink-muted">
            {course?.code}
            <span className="ml-2 text-[12px] text-ink-subtle">编码是课程标识，不可修改</span>
          </p>
        </div>
      ) : (
        <label className="flex flex-col gap-1.5">
          <span className="text-[13px] font-medium text-ink">
            课程编码
            <span className="ml-2 text-[12px] text-ink-subtle">全局唯一</span>
          </span>
          <input
            value={code}
            onChange={(event) => setCode(event.target.value)}
            placeholder="例如：CS101"
            className={`${inputClass} h-11`}
          />
        </label>
      )}

      <label className="flex flex-col gap-1.5">
        <span className="text-[13px] font-medium text-ink">
          课程简介
          <span className="ml-2 text-[12px] text-ink-subtle">选填</span>
        </span>
        <textarea
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          rows={3}
          placeholder="一句话介绍这门课程"
          className={`${inputClass} resize-y leading-relaxed`}
        />
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="text-[13px] font-medium text-ink">
          学期标识
          <span className="ml-2 text-[12px] text-ink-subtle">选填，例如：2026秋</span>
        </span>
        <input
          value={semester}
          onChange={(event) => setSemester(event.target.value)}
          placeholder="2026秋"
          className={`${inputClass} h-11`}
        />
      </label>

      {error ? (
        <p
          role="alert"
          className="rounded-md border border-danger-line bg-danger-soft px-3 py-2 text-[13px] text-danger-ink"
        >
          {error}
        </p>
      ) : null}

      <div className="flex justify-end gap-3">
        <button
          type="button"
          onClick={onCancel}
          className="co-focusable cursor-pointer rounded-md border border-line bg-canvas px-4 py-2 text-[14px] font-medium text-ink transition-colors duration-150 ease-standard hover:bg-panel"
        >
          取消
        </button>
        <button
          type="submit"
          disabled={pending}
          className="co-focusable cursor-pointer rounded-md bg-brand px-4 py-2 text-[14px] font-medium text-white transition-colors duration-150 ease-standard hover:bg-brand-strong disabled:cursor-not-allowed disabled:bg-line disabled:text-ink-subtle"
        >
          {pending ? "保存中…" : editing ? "保存修改" : "创建课程"}
        </button>
      </div>
    </form>
  );
}
