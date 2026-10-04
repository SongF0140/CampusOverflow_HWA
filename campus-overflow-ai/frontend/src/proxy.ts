import { NextResponse, type NextRequest } from "next/server";

import { loginUrlFor } from "@/shared/utils/redirect";

// Next.js 16 起，middleware 文件约定更名为 proxy（导出函数名同名）
// 登录口径（以最新接口文档与实现为准）：所有读取接口（问题列表 / 详情 / 课程 / 标签 / 搜索）
// 都要求登录，因此除登录、注册、403 外，其余页面一律要求登录态。
// /design 是设计系统验收页，不含任何数据，放行便于评审查看。
const PUBLIC_PATHS = new Set(["/auth/login", "/auth/register", "/403", "/design"]);

const TOKEN_COOKIE = "co_token";

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (PUBLIC_PATHS.has(pathname)) return NextResponse.next();

  if (request.cookies.get(TOKEN_COOKIE)?.value) return NextResponse.next();

  // 401：跳登录并带回跳地址（含查询参数，如 /questions/new?course_id=3），登录后回到原页面
  return NextResponse.redirect(
    loginUrlFor(pathname, request.nextUrl.search, request.nextUrl.origin),
  );
}

export const config = {
  // 除 BFF / 静态资源外全部经过守卫
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};
