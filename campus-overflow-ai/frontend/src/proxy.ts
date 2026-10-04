import { NextResponse, type NextRequest } from "next/server";

import { loginUrlFor } from "@/shared/utils/redirect";

// Next.js 16 起，middleware 文件约定更名为 proxy（导出函数名同名）
// 需要登录的路径：未登录先引导登录；越权入口由页面按角色控制不渲染（前端服务需求文档 §3.6）
// 注意 /questions/[id] 详情页是公开的，只有 /questions/[id]/edit 需要登录
const PROTECTED_PATTERNS = [
  /^\/me(\/|$)/,
  /^\/notifications(\/|$)/,
  /^\/appeals\/new$/,
  /^\/questions\/new$/,
  /^\/questions\/[^/]+\/edit$/,
  /^\/teacher(\/|$)/,
  /^\/admin(\/|$)/,
];

const TOKEN_COOKIE = "co_token";

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const needsAuth = PROTECTED_PATTERNS.some((pattern) => pattern.test(pathname));
  if (!needsAuth) return NextResponse.next();

  if (request.cookies.get(TOKEN_COOKIE)?.value) return NextResponse.next();

  // 401：跳登录并带回跳地址（含查询参数，如 /questions/new?course_id=3），登录后回到原页面
  return NextResponse.redirect(
    loginUrlFor(pathname, request.nextUrl.search, request.nextUrl.origin),
  );
}

export const config = {
  matcher: [
    "/me/:path*",
    "/notifications/:path*",
    "/appeals/new",
    "/questions/new",
    "/questions/:id/edit",
    "/teacher/:path*",
    "/admin/:path*",
  ],
};
