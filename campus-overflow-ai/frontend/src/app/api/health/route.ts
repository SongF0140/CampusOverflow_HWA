// 健康检查 Route Handler：聚合探测业务后端与 Agent 服务（对应 T-01 完成判定"三服务 /health 互通"）
// 任一下游服务不可用时不抛错，降级返回 down（对应 spec X-02：AI 服务不可用不影响基础功能）
export const dynamic = "force-dynamic";

// 下游地址走环境变量（T-18 容器化）：容器内 localhost 不是后端/Agent，
// compose 注入 BACKEND_ORIGIN=http://backend:8000、AGENT_ORIGIN=http://agent:8787
const BACKEND_ORIGIN = process.env.BACKEND_ORIGIN ?? "http://localhost:8000";
const AGENT_ORIGIN = process.env.AGENT_ORIGIN ?? "http://localhost:8787";

const checkService = async (url: string): Promise<string> => {
  try {
    const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(3000) });
    return res.ok ? "up" : "degraded";
  } catch {
    return "down";
  }
};

export async function GET(): Promise<Response> {
  const [backend, agent] = await Promise.all([
    checkService(`${BACKEND_ORIGIN}/api/health`),
    checkService(`${AGENT_ORIGIN}/agent/health`),
  ]);

  return Response.json({
    code: 200,
    data: { frontend: "up", backend, agent },
    message: "ok",
  });
}
