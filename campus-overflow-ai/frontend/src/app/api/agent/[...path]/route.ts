# BFF AI 转发：/api/agent/** → Agent :8787（一期占位，Agent 服务随第二阶段搭建）
export const dynamic = "force-dynamic";

const AGENT_ORIGIN = process.env.AGENT_ORIGIN ?? "http://localhost:8787";

async function proxy(
  request: Request,
  ctx: { params: Promise<{ path: string[] }> },
): Promise<Response> {
  const { path } = await ctx.params;
  const incoming = new URL(request.url);
  // /api/agent/agent/runs/{id} → Agent 服务 /agent/runs/{id}
  const target = `${AGENT_ORIGIN}/${path.join("/")}${incoming.search}`;

  // TODO(第二阶段): SSE 流式响应不缓冲（similar-questions / suggest-tags 为 SSE 接口）
  const body = ["GET", "HEAD"].includes(request.method)
    ? undefined
    : await request.text();

  try {
    const resp = await fetch(target, {
      method: request.method,
      headers: { "content-type": request.headers.get("content-type") ?? "application/json" },
      body,
      cache: "no-store",
    });
    const data = await resp.text();
    return new Response(data, {
      status: resp.status,
      headers: { "content-type": resp.headers.get("content-type") ?? "application/json" },
    });
  } catch {
    // AI 服务不可用时主流程不受影响：前端卡片隐藏，此处返回 503 供前端识别
    return Response.json(
      { code: 503, data: null, message: "AI 服务暂不可用，请稍后重试" },
      { status: 503 },
    );
  }
}

export const GET = proxy;
export const POST = proxy;
