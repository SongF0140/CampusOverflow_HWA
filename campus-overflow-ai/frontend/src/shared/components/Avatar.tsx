export type AvatarSize = "sm" | "md" | "lg";

const SIZE_CLASS: Record<AvatarSize, string> = {
  sm: "h-6 w-6 text-[11px]",
  md: "h-8 w-8 text-[13px]",
  lg: "h-16 w-16 text-[24px]",
};

// 头像：圆形；无图时用昵称首字 fallback（panel 底 + ink 字，不留空白）
export function Avatar({
  name,
  src,
  size = "md",
  className = "",
}: {
  name: string;
  src?: string;
  size?: AvatarSize;
  className?: string;
}) {
  const fallbackChar = name.trim().charAt(0) || "？";
  if (!src) {
    return (
      <span
        aria-hidden="true"
        className={`inline-flex shrink-0 select-none items-center justify-center rounded-full bg-panel font-medium text-ink ${SIZE_CLASS[size]} ${className}`}
      >
        {fallbackChar}
      </span>
    );
  }
  return (
    <img
      src={src}
      alt={name}
      className={`shrink-0 rounded-full object-cover ${SIZE_CLASS[size]} ${className}`}
    />
  );
}
