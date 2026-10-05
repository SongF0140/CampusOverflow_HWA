"use client";

// 新建/编辑课程共用 Modal（页面控件级设计说明 §3.2/§3.3）：
// 新建 POST /courses（name/code 必填），编辑 PATCH /courses/{id}（后端 CourseUpdateRequest
// 不收 code → lockCode 置灰，仅可改名称/学期/简介）。表单状态放在内层组件，
// 以 key 重挂载替代 effect 重置（避免 react-hooks/set-state-in-effect）。
import { useState } from "react";
import type { FormEvent } from "react";

import {
  Button,
  Input,
  Modal,
  Select,
  Textarea,
} from "@/shared/components";

export interface CourseFormValues {
  name: string;
  code: string;
  description: string | null;
  semester: string | null;
}

// 学期为后端自由字符串（≤20 字），前端提供常用预设，空值=未指定
export const SEMESTER_OPTIONS = [
  { value: "", label: "未指定" },
  { value: "2025秋", label: "2025 秋" },
  { value: "2026春", label: "2026 春" },
  { value: "2026秋", label: "2026 秋" },
  { value: "2027春", label: "2027 春" },
  { value: "2027秋", label: "2027 秋" },
];

function CourseFormFields({
  initial,
  lockCode,
  submitting,
  submitError,
  onSubmit,
  onClose,
}: {
  initial: CourseFormValues | null;
  lockCode: boolean;
  submitting: boolean;
  submitError: string | null;
  onSubmit: (values: CourseFormValues) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [code, setCode] = useState(initial?.code ?? "");
  const [semester, setSemester] = useState(initial?.semester ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [nameError, setNameError] = useState("");
  const [codeError, setCodeError] = useState("");

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextNameError = name.trim() === "" ? "课程名不能为空" : "";
    const nextCodeError = code.trim() === "" ? "课程编码不能为空" : "";
    setNameError(nextNameError);
    setCodeError(nextCodeError);
    if (nextNameError !== "" || nextCodeError !== "") return;
    onSubmit({
      name: name.trim(),
      code: code.trim(),
      description: description.trim() === "" ? null : description.trim(),
      semester: semester === "" ? null : semester,
    });
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
      <Input
        label="课程名"
        value={name}
        maxLength={50}
        onChange={(event) => setName(event.target.value)}
        error={nameError || undefined}
        aria-invalid={nameError !== "" || undefined}
      />
      <Input
        label="课程编码"
        value={code}
        maxLength={50}
        disabled={lockCode}
        hint={lockCode ? "课程编码创建后不可修改" : "全局唯一，如 CS101"}
        onChange={(event) => setCode(event.target.value)}
        error={codeError || undefined}
        aria-invalid={codeError !== "" || undefined}
      />
      <Select
        label="学期"
        value={semester}
        options={SEMESTER_OPTIONS}
        onChange={(event) => setSemester(event.target.value)}
      />
      <Textarea
        label="课程简介"
        rows={4}
        maxLength={500}
        value={description}
        onChange={(event) => setDescription(event.target.value)}
      />
      {submitError !== null ? (
        <p role="alert" className="text-[12px] text-danger-ink">
          {submitError}
        </p>
      ) : null}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose} disabled={submitting}>
          取消
        </Button>
        <Button type="submit" isLoading={submitting}>
          {submitting ? "保存中…" : "保存"}
        </Button>
      </div>
    </form>
  );
}

export function CourseFormModal({
  open,
  title,
  initial = null,
  lockCode = false,
  submitting = false,
  submitError = null,
  onSubmit,
  onClose,
}: {
  open: boolean;
  title: string;
  initial?: CourseFormValues | null;
  lockCode?: boolean;
  submitting?: boolean;
  submitError?: string | null;
  onSubmit: (values: CourseFormValues) => void;
  onClose: () => void;
}) {
  return (
    <Modal open={open} onClose={submitting ? () => undefined : onClose} title={title}>
      {/* 关闭时 Modal 卸载子树 → 每次打开都按 initial 重新预填 */}
      <CourseFormFields
        initial={initial}
        lockCode={lockCode}
        submitting={submitting}
        submitError={submitError}
        onSubmit={onSubmit}
        onClose={onClose}
      />
    </Modal>
  );
}
