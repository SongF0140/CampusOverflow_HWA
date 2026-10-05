// 路由守卫纯函数：供 src/proxy.ts（Next.js 16 的 middleware 约定）与单元测试共用。
// 仅做 UX 层守卫——不验签、不做真实鉴权，真实权限校验由 FastAPI 在接口层强制
// （前端服务需求文档 §3.6：前端隐藏只是体验，服务端仍会二次校验）。
// 运行在 Edge 环境：只用 atob 等标准 API，不碰 node:* 模块。

export type GuardRole = "student" | "teacher" | "admin";

// 后端 create_access_token 的 payload 只含 sub/role/exp/iat（backend/app/core/security.py），
// 没有助教能力位声明，因此边缘侧无法区分"学生"与"研究生助教"。
export interface JwtPayloadLike {
  sub?: string;
  role?: string;
}

// 手写 base64url 解码（不用 node:buffer）：失败（缺段/非 base64/非 JSON）一律返回 null
export function decodeJwtPayload(token: string): JwtPayloadLike | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
    return JSON.parse(atob(padded)) as JwtPayloadLike;
  } catch {
    return null;
  }
}

// 从 Cookie 里的 JWT 提取角色；无 Cookie / 无法解析 / 未知角色一律视为未识别
export function roleFromToken(token: string | null | undefined): GuardRole | null {
  if (!token) return null;
  const role = decodeJwtPayload(token)?.role;
  return role === "student" || role === "teacher" || role === "admin" ? role : null;
}

// 已登录访问登录/注册页时按角色送回对应端首页
const AUTH_PAGE_PATHS = new Set(["/auth/login", "/auth/register"]);

// 受保护前缀（页面控件级设计说明 §1 + 前端服务需求文档 §3.6）：
// 其余页面（问题广场 / 课程 / 榜单 / 搜索 / 用户主页 / 403 / design）游客可浏览
const PROTECTED_PREFIXES = [
  "/teacher",
  "/admin",
  "/me",
  "/notifications",
  "/questions/new",
  "/appeals/new",
];

// /questions/[id]/edit：动态段形态单独匹配
const QUESTION_EDIT_PATTERN = /^\/questions\/[^/]+\/edit\/?$/;

export function isProtectedPath(pathname: string): boolean {
  if (QUESTION_EDIT_PATTERN.test(pathname)) return true;
  return PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

// 与 session-store.homePathFor 保持同口径；因 store 带 "use client" 不能被 Edge 侧 import，此处独立实现
export function homePathForRole(role: GuardRole): string {
  if (role === "admin") return "/admin";
  if (role === "teacher") return "/teacher";
  return "/";
}

export interface GuardDecision {
  action: "allow" | "redirect";
  destination?: string;
}

function loginRedirect(pathname: string, search: string): GuardDecision {
  // returnTo 带原路径与查询串（如 /teacher/moderation?case_id=1），登录后回原页
  const returnTo = encodeURIComponent(`${pathname}${search}`);
  return { action: "redirect", destination: `/auth/login?returnTo=${returnTo}` };
}

function forbiddenRedirect(): GuardDecision {
  return { action: "redirect", destination: "/403" };
}

/**
 * 守卫判定主入口：
 * - 受保护路径无登录 Cookie → 302 /auth/login?returnTo=<原路径>
 * - /admin/** 仅 admin；学生 / 教师访问 → 302 /403
 * - /teacher/** 教师与管理员放行；学生放行由页面层处理（JWT 无能力位，边缘侧无法区分助教）
 * - 已登录访问 /auth/** → 按角色 302 回对应端首页
 * - 其余一律放行
 */
export function decideGuard(
  pathname: string,
  token: string | null | undefined,
  search = "",
): GuardDecision {
  if (AUTH_PAGE_PATHS.has(pathname)) {
    const role = roleFromToken(token);
    return role ? { action: "redirect", destination: homePathForRole(role) } : { action: "allow" };
  }

  if (!isProtectedPath(pathname)) return { action: "allow" };

  const role = roleFromToken(token);
  if (!role) return loginRedirect(pathname, search);

  if (pathname === "/admin" || pathname.startsWith("/admin/")) {
    return role === "admin" ? { action: "allow" } : forbiddenRedirect();
  }

  return { action: "allow" };
}
