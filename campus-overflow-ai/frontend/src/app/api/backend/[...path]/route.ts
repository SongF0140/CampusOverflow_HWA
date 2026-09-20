# BFF 业务转发：/api/backend/api/** → FastAPI :8000（T-01 起提供，二阶段注入登录态与 trace id）
export const dynamic = "force-dynamic";

const BACKEND_ORIGIN = process.env.BACKEND_ORIGIN ?? "http://localhost:8000";

async function proxy(
  request: Request,
  ctx: { params: Promise<{ path: string[] }> },
): Promise<Response> {
  const { path } = await ctx.params;
  const incoming = new URL(request.url);
  // 浏览器统一调 /api/backend/api/**，转发时去掉 /api/backend 前缀
  const target = `${BACKEND_ORIGIN}/${path.join("/")}${incoming.search}`;

  const headers = new Headers();
  const contentType = request.headers.get("content-type");
  if (contentType) headers.set("content-type", contentType);
  // TODO(第二阶段): 从 HttpOnly Cookie 读 JWT 注入 Authorization；生成并透传 x-trace-id

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
  return new Response(data, {
    status: resp.status,
    headers: { "content-type": resp.headers.get("content-type") ?? "application/json" },
  });
}

export const GET = proxy;
export const POST = proxy;
export const PATCH = proxy;
export const PUT = proxy;
export const DELETE = proxy;
