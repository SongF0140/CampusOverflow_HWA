"use client";

// 登录跳转辅助：401 时由调用方决定是否调用（hooks 不自动跳转）

// 当前站内路径（含查询串），SSR 环境回落根路径
export function currentPath(): string {
  if (typeof window === "undefined") return "/";
  return `${window.location.pathname}${window.location.search}`;
}

// 跳到登录页并携带回跳地址；returnTo 缺省取当前路径
// 独立工具函数拿不到 useRouter（hook 只能在组件内调用），故用整页跳转兜底
export function redirectToLogin(returnTo?: string): void {
  const target = returnTo ?? currentPath();
  // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- 非 React 上下文的兜底跳转
  window.location.assign(`/auth/login?returnTo=${encodeURIComponent(target)}`);
}
