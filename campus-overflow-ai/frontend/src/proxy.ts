import { NextResponse, type NextRequest } from "next/server";

import { decideGuard } from "@/features/layout/guard";

// Next.js 16 起，middleware 文件约定更名为 proxy（导出函数名同名）
// 登录口径（以最新接口文档与实现为准）：所有读取接口（问题列表 / 详情 / 课程 / 标签 / 搜索）
// 都要求登录，因此除登录、注册、403 外，其余页面一律要求登录态。
// /design 是设计系统验收页，不含任何数据，放行便于评审查看。
const PUBLIC_PATHS = new Set(["/auth/login", "/auth/register", "/403", "/design"]);

// Next.js 16 起，middleware 文件约定更名为 proxy（导出函数名同名）。
// 这里只做 UX 层路由守卫（判定逻辑见 src/features/layout/guard.ts，便于单测）：
// - 受保护页无登录 Cookie → 302 登录页并带 returnTo
// - /admin/** 仅管理员，角色不匹配 → 302 /403（真实鉴权由 FastAPI 接口层强制）
// - 公开页（问题广场 / 课程 / 榜单 / 搜索等）游客可浏览（前端服务需求文档 §3.6）
const TOKEN_COOKIE = "co_token";

// decideGuard 判定的目标一律是站内绝对路径（/auth/login?returnTo=... / /403 / /admin 等），
// 这里只负责补全 origin 并 302，不重新推导跳转目标——否则 /403 与角色首页分流会被覆盖成登录页。
export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const token = request.cookies.get(TOKEN_COOKIE)?.value ?? null;
  const decision = decideGuard(pathname, token, search);

  if (decision.action !== "redirect" || !decision.destination) {
    return NextResponse.next();
  }

  return NextResponse.redirect(new URL(decision.destination, request.nextUrl.origin));
}

export const config = {
  // 除 BFF / 静态资源外全部经过守卫
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};
