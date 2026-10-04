// 登录回跳地址的生成与校验（守卫与登录表单共用，避免两处规则不一致）

/**
 * 只接受站内路径：拒绝 //evil.com、/\evil.com、https://evil.com 这类站外地址（防开放重定向）。
 * 允许带查询参数，例如 /questions/new?course_id=3。
 */
export function toInternalPath(value?: string | null): string | null {
  if (!value) return null;
  if (!value.startsWith("/")) return null;
  if (value.startsWith("//") || value.startsWith("/\\")) return null;
  return value;
}

/** 构造登录跳转地址：保留 pathname + search，登录后能回到原页面（含查询参数） */
export function loginUrlFor(pathname: string, search: string, origin: string): string {
  const url = new URL("/auth/login", origin);
  url.searchParams.set("returnTo", `${pathname}${search}`);
  return url.toString();
}
