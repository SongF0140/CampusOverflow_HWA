// BFF 业务转发：/api/backend/api/** → FastAPI :8000（T-01 起提供，二阶段注入登录态与 trace id）
import type { BackendLoginResult } from "@/shared/types/auth";

export const dynamic = "force-dynamic";

const BACKEND_ORIGIN = process.env.BACKEND_ORIGIN ?? "http://localhost:8000";

// 登录态用 HttpOnly Cookie 保存，前端组件不读取 token（见 前端服务需求文档 §3.3）
const TOKEN_COOKIE = "co_token";
const TOKEN_MAX_AGE = 60 * 60 * 24; // 24h，与后端 jwt_expire_minutes 对齐

interface TokenReadResult {
  token: string | null;
  /** Cookie 值无法解码（被篡改或损坏）时为 true，需要清除该 Cookie */
  malformed: boolean;
}

function readToken(request: Request): TokenReadResult {
  const cookie = request.headers.get("cookie");
  if (!cookie) return { token: null, malformed: false };
  const hit = cookie
    .split(";")
    .map((item) => item.trim())
    .find((item) => item.startsWith(`${TOKEN_COOKIE}=`));
  if (!hit) return { token: null, malformed: false };
  try {
    return { token: decodeURIComponent(hit.slice(TOKEN_COOKIE.length + 1)), malformed: false };
  } catch {
    // 非法 % 转义等：按未登录继续处理，不要抛错导致 BFF 返回 500
    return { token: null, malformed: true };
  }
}

function tokenCookie(token: string): string {
  // 生产环境（https）加 Secure；本地 http 开发不加，否则浏览器不会保存
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${TOKEN_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${TOKEN_MAX_AGE}${secure}`;
}

function clearCookie(): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${TOKEN_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
}

async function proxy(
  request: Request,
  ctx: { params: Promise<{ path: string[] }> },
): Promise<Response> {
  const { path } = await ctx.params;
  const incoming = new URL(request.url);
  // 浏览器统一调 /api/backend/api/**，转发时去掉 /api/backend 前缀
  const target = `${BACKEND_ORIGIN}/${path.join("/")}${incoming.search}`;
  const route = path.join("/");

  // 退出登录：后端 JWT 无状态，无对应接口，由 BFF 清 Cookie 即可（幂等）
  if (route === "api/auth/logout") {
    return Response.json(
      { code: 200, data: null, message: "已退出登录" },
      { headers: { "set-cookie": clearCookie() } },
    );
  }

  const headers = new Headers();
  const contentType = request.headers.get("content-type");
  if (contentType) headers.set("content-type", contentType);
  // 从 HttpOnly Cookie 读 JWT 注入 Authorization
  const { token, malformed } = readToken(request);
  if (token) headers.set("authorization", `Bearer ${token}`);
  // 链路追踪：透传或生成 x-trace-id
  headers.set("x-trace-id", request.headers.get("x-trace-id") ?? crypto.randomUUID());

  const body = ["GET", "HEAD"].includes(request.method)
    ? undefined
    : await request.text();

  const resp = await fetch(target, {
    method: request.method,
    headers,
    body,
    cache: "no-store",
  });

  const data = await resp.text();
  const responseHeaders = new Headers({
    "content-type": resp.headers.get("content-type") ?? "application/json",
  });

  // 损坏的 Cookie：清掉它，并按未登录继续返回后端结果
  if (malformed) {
    responseHeaders.append("set-cookie", clearCookie());
  }

  // 登录成功：把 access_token 写进 HttpOnly Cookie，响应体里不带出 token
  if (route === "api/auth/login" && resp.ok) {
    let parsed: { code?: number; data?: Partial<BackendLoginResult>; message?: string } | null = null;
    try {
      parsed = JSON.parse(data) as { code?: number; data?: Partial<BackendLoginResult>; message?: string };
    } catch {
      parsed = null;
    }
    if (parsed) {
      const accessToken = parsed.data?.access_token;
      if (accessToken && parsed.data) {
        responseHeaders.append("set-cookie", tokenCookie(accessToken));
        delete parsed.data?.access_token;
      }
      return Response.json(parsed, { status: resp.status, headers: responseHeaders });
    }
  }

  // 凭证已失效（如 token 过期）：清掉死 Cookie，避免后续请求一直带无效令牌
  if (resp.status === 401 && token) {
    responseHeaders.append("set-cookie", clearCookie());
  }

  return new Response(data, {
    status: resp.status,
    headers: responseHeaders,
  });
}

export const GET = proxy;
export const POST = proxy;
export const PATCH = proxy;
export const PUT = proxy;
export const DELETE = proxy;
