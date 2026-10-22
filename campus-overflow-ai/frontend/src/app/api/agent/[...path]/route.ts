// BFF AI 转发：仅从 HttpOnly Cookie 提取用户凭证，不信任浏览器自报身份。
export const dynamic = "force-dynamic";

const AGENT_ORIGIN = process.env.AGENT_ORIGIN ?? "http://localhost:8787";

function readUserToken(request: Request): string | null {
  const cookie = request.headers.get("cookie") ?? "";
  const entry = cookie.split(";").map((item) => item.trim()).find((item) => item.startsWith("co_token="));
  if (!entry) return null;
  try {
    const token = decodeURIComponent(entry.slice("co_token=".length));
    return token && /^[A-Za-z0-9._~+/-]+=*$/.test(token) ? token : null;
  } catch {
    return null;
  }
}

async function proxy(
  request: Request,
  ctx: { params: Promise<{ path: string[] }> },
): Promise<Response> {
  const { path } = await ctx.params;
  const incoming = new URL(request.url);
  // /api/agent/agent/runs/{id} → Agent 服务 /agent/runs/{id}
  const target = `${AGENT_ORIGIN}/${path.join("/")}${incoming.search}`;
  const traceId = request.headers.get("x-trace-id")?.trim() || crypto.randomUUID();
  const requestHeaders = new Headers({
    "content-type": request.headers.get("content-type") ?? "application/json",
    "x-trace-id": traceId,
  });
  const token = readUserToken(request);
  if (token) requestHeaders.set("authorization", `Bearer ${token}`);

  const body = ["GET", "HEAD"].includes(request.method)
    ? undefined
    : await request.text();

  try {
    const resp = await fetch(target, {
      method: request.method,
      headers: requestHeaders,
      body,
      cache: "no-store",
      signal: request.signal,
    });
    const contentType = resp.headers.get("content-type") ?? "application/json";
    const headers = new Headers({ "content-type": contentType, "x-trace-id": traceId });
    if (contentType.includes("text/event-stream")) {
      headers.set("cache-control", "no-cache, no-transform");
      headers.set("x-accel-buffering", "no");
    }
    return new Response(resp.body, {
      status: resp.status,
      headers,
    });
  } catch {
    // AI 服务不可用时主流程不受影响：前端卡片隐藏，此处返回 503 供前端识别
    return Response.json(
      { code: 503, data: null, message: "AI 服务暂不可用，请稍后重试" },
      { status: 503, headers: { "x-trace-id": traceId } },
    );
  }
}

export const GET = proxy;
export const POST = proxy;
