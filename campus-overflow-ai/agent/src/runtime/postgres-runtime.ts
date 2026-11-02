import { randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { once } from "node:events";

export const resolveWorkflowRuntimeConfig = (env: NodeJS.ProcessEnv) => {
  if (env.WORKFLOW_RUNTIME_ENABLED !== "true") return;
  if (env.WORKFLOW_TARGET_WORLD !== "@workflow/world-postgres") {
    if (env.NODE_ENV === "production") throw new Error("生产Workflow必须使用专用Postgres World");
    return { kind: "local" as const };
  }
  const url = env.WORKFLOW_POSTGRES_URL;
  if (!url || !/^postgres(ql)?:\/\//.test(url)) throw new Error("Workflow专用Postgres连接未配置");
  const port = Number(env.WORKFLOW_CALLBACK_PORT ?? "8788");
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error("Workflow回调端口无效");
  return { kind: "postgres" as const, port, url };
};

/** 只绑定loopback；凭据在服务器启动时生成，不接受来源IP/Forwarded等自报身份。 */
export const startWorkflowCallbackProxy = async (options: { targetUrl: string; secret: string; port: number }) => {
  const server = createServer((request, response) => {
    void (async () => {
      const path = new URL(request.url ?? "/", "http://localhost");
      if (!path.pathname.startsWith("/.well-known/workflow/")) { response.writeHead(404).end(); return; }
      if (request.method !== "POST") { response.writeHead(405).end(); return; }
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of request) {
        size += chunk.length;
        if (size > 1024 * 1024) { response.writeHead(413).end(); return; }
        chunks.push(Buffer.from(chunk));
      }
      const headers = new Headers();
      for (const [name, value] of Object.entries(request.headers)) {
        if (value && !["host", "connection", "content-length", "transfer-encoding"].includes(name)) headers.set(name, String(value));
      }
      headers.set("x-workflow-internal-key", options.secret);
      const result = await fetch(new URL(path.pathname + path.search, options.targetUrl), {
        method: "POST", headers, body: Buffer.concat(chunks), signal: AbortSignal.timeout(60_000), redirect: "error",
      });
      response.writeHead(result.status, { "content-type": result.headers.get("content-type") ?? "application/json" });
      response.end(Buffer.from(await result.arrayBuffer()));
    })().catch(() => { if (!response.headersSent) response.writeHead(503); response.end(); });
  });
  server.listen(options.port, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Workflow回调监听失败");
  return { baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())) };
};

export const startWorkflowRuntime = async () => {
  const config = resolveWorkflowRuntimeConfig(process.env);
  if (!config) return () => undefined;
  const proxy = config.kind === "postgres" ? await startWorkflowCallbackProxy({
    targetUrl: `http://127.0.0.1:${process.env.PORT ?? "8787"}`, port: config.port, secret: (() => {
      const secret = randomBytes(32).toString("hex"); process.env.WORKFLOW_CALLBACK_SECRET = secret; return secret;
    })(),
  }) : undefined;
  if (proxy) process.env.WORKFLOW_LOCAL_BASE_URL = proxy.baseUrl;
  try {
    const { getWorld, setWorld } = await import("workflow/runtime");
    if (config.kind === "postgres") {
      const { createWorld } = await import("@workflow/world-postgres");
      setWorld(createWorld({ connectionString: config.url,
        applicationManagedShutdown: true, queueConcurrency: 5 }));
    }
    const world = await getWorld();
    await world.start?.();
    return async () => { try { await world.close?.(); } finally { await proxy?.close(); } };
  } catch (error) { await proxy?.close(); throw error; }
};
