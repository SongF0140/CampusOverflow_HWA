"use client";

import { useId } from "react";
import type { ComponentProps } from "react";

import { renderFieldFooter, type FormFieldExtra } from "./Input";

export function Textarea({
  label,
  error,
  hint,
  id,
  rows = 6,
  className = "",
  ...rest
}: ComponentProps<"textarea"> & FormFieldExtra) {
  const autoId = useId();
  const textareaId = id ?? autoId;
  const hasError = typeof error === "string" && error.length > 0;
  return (
    <div className="flex w-full flex-col gap-1">
      {label ? (
        <label htmlFor={textareaId} className="text-[13px] font-medium text-ink-muted">
          {label}
        </label>
      ) : null}
      <textarea
        id={textareaId}
        rows={rows}
        aria-invalid={hasError || undefined}
        className={`w-full rounded-md border bg-canvas px-3 py-2 text-[14px] leading-[1.75] text-ink placeholder:text-ink-subtle transition-colors duration-150 ease-standard focus:outline-2 focus:-outline-offset-1 disabled:cursor-not-allowed disabled:bg-panel ${
          hasError ? "border-danger focus:outline-danger" : "border-line focus:outline-brand"
        } ${className}`}
        {...rest}
      />
      {renderFieldFooter(error, hint)}
    </div>
  );
}
