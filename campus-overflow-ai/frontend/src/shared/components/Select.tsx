"use client";

import { useId } from "react";
import type { ComponentProps } from "react";

import { renderFieldFooter, type FormFieldExtra } from "./Input";

export interface SelectOption {
  value: string;
  label: string;
}

// 简单优先：原生 select + options 数组；需要分组等复杂结构时可直接传 children
export function Select({
  label,
  error,
  hint,
  options,
  children,
  id,
  className = "",
  ...rest
}: ComponentProps<"select"> & FormFieldExtra & { options?: SelectOption[] }) {
  const autoId = useId();
  const selectId = id ?? autoId;
  const hasError = typeof error === "string" && error.length > 0;
  return (
    <div className="flex w-full flex-col gap-1">
      {label ? (
        <label htmlFor={selectId} className="text-[13px] font-medium text-ink-muted">
          {label}
        </label>
      ) : null}
      <select
        id={selectId}
        aria-invalid={hasError || undefined}
        className={`h-11 w-full cursor-pointer rounded-md border bg-canvas px-3 text-[14px] text-ink transition-colors duration-150 ease-standard focus:outline-2 focus:-outline-offset-1 disabled:cursor-not-allowed disabled:bg-panel ${
          hasError ? "border-danger focus:outline-danger" : "border-line focus:outline-brand"
        } ${className}`}
        {...rest}
      >
        {options
          ? options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))
          : children}
      </select>
      {renderFieldFooter(error, hint)}
    </div>
  );
}
