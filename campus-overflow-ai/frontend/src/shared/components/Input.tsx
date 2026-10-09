"use client";

import { useId } from "react";
import type { ComponentProps } from "react";

export interface FormFieldExtra {
  label?: string;
  error?: string;
  hint?: string;
}

// 表单控件共用包装：label 关联 + 行内错误/提示（错误优先于提示）
export function renderFieldFooter(error: string | undefined, hint: string | undefined) {
  if (error) {
    return (
      <p role="alert" className="text-[12px] text-danger-ink">
        {error}
      </p>
    );
  }
  if (hint) {
    return <p className="text-[12px] text-ink-subtle">{hint}</p>;
  }
  return null;
}

export function Input({
  label,
  error,
  hint,
  id,
  className = "",
  ...rest
}: ComponentProps<"input"> & FormFieldExtra) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const hasError = typeof error === "string" && error.length > 0;
  return (
    <div className="flex w-full flex-col gap-1">
      {label ? (
        <label htmlFor={inputId} className="text-[13px] font-medium text-ink-muted">
          {label}
        </label>
      ) : null}
      <input
        id={inputId}
        aria-invalid={hasError || undefined}
        className={`h-11 w-full rounded-md border bg-canvas px-3 text-[14px] text-ink placeholder:text-ink-subtle transition-colors duration-150 ease-standard focus:outline-2 focus:-outline-offset-1 disabled:cursor-not-allowed disabled:bg-panel ${
          hasError ? "border-danger focus:outline-danger" : "border-line focus:outline-brand"
        } ${className}`}
        {...rest}
      />
      {renderFieldFooter(error, hint)}
    </div>
  );
}
