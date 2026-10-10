"use client";

import type { ComponentProps } from "react";

export type ButtonVariant = "primary" | "ghost" | "danger";
export type ButtonSize = "md" | "sm";

const VARIANT_CLASS: Record<ButtonVariant, string> = {
  // 设计系统 §2：primary 只用强调色；danger 用语义红
  primary: "bg-brand text-white hover:bg-brand-strong",
  ghost: "border border-line bg-canvas text-ink hover:bg-panel",
  danger: "bg-danger text-white hover:opacity-90",
};

const SIZE_CLASS: Record<ButtonSize, string> = {
  md: "h-10 px-4 text-[14px]",
  sm: "h-9 px-3 text-[13px]",
};

export function Button({
  variant = "primary",
  size,
  isLoading = false,
  type = "button",
  disabled,
  className = "",
  children,
  ...rest
}: ComponentProps<"button"> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  isLoading?: boolean;
}) {
  // 未显式指定 size 时：次按钮默认 36px，主/危险按钮 40px（页面控件级设计说明 §0.2）
  const resolvedSize = size ?? (variant === "ghost" ? "sm" : "md");
  return (
    <button
      type={type}
      disabled={disabled || isLoading}
      aria-busy={isLoading || undefined}
      className={`co-focusable inline-flex cursor-pointer items-center justify-center gap-2 rounded-md font-medium transition-colors duration-150 ease-standard disabled:cursor-not-allowed disabled:opacity-60 ${VARIANT_CLASS[variant]} ${SIZE_CLASS[resolvedSize]} ${className}`}
      {...rest}
    >
      {isLoading ? (
        <span
          aria-hidden="true"
          className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent motion-reduce:animate-none"
        />
      ) : null}
      {children}
    </button>
  );
}
