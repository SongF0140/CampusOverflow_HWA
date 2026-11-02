import { createServer } from "node:http";
import { once } from "node:events";
import { expect, it, vi } from "vitest";
import { resolveWorkflowRuntimeConfig, startWorkflowCallbackProxy } from "../src/runtime/postgres-runtime.js";
import { checkWorkflowAccess } from "../src/runtime/workflow-access.js";

const key = "a".repeat(64);
const pgEnv = { WORKFLOW_RUNTIME_ENABLED: "true", WORKFLOW_TARGET_WORLD: "@workflow/world-postgres",
  WORKFLOW_POSTGRES_URL: "postgres://test@127.0.0.1/test", NODE_ENV: "production", WORKFLOW_CALLBACK_SECRET: key };

it("Postgres必须显式使用独立连接，不能回退通用DATABASE_URL", () => {
  expect(() => resolveWorkflowRuntimeConfig({ ...pgEnv, WORKFLOW_POSTGRES_URL: "", DATABASE_URL: "postgres://business" })).toThrow();
  expect(resolveWorkflowRuntimeConfig(pgEnv)?.kind).toBe("postgres");
});
it("生产不能使用Local World提供持久执行", () => {
  expect(() => resolveWorkflowRuntimeConfig({ WORKFLOW_RUNTIME_ENABLED: "true", NODE_ENV: "production" })).toThrow();
});
it("生产内部handler只接受服务器回调凭据，不信任缺失或伪造头", () => {
  const path = "/.well-known/workflow/v1/flow";
  expect(checkWorkflowAccess(path, pgEnv)?.status).toBe(403);
  expect(checkWorkflowAccess(path, pgEnv, "forged")?.status).toBe(403);
  expect(checkWorkflowAccess(path, pgEnv, key)).toBeUndefined();
});
it("loopback代理仅转发内部路径，覆盖调用者提供的凭据", async () => {
  const seen = vi.fn();
  const target = createServer((req, res) => { seen(req.headers["x-workflow-internal-key"]); res.end("ok"); });
  target.listen(0, "127.0.0.1");
  await once(target, "listening");
  const addr = target.address();
  if (!addr || typeof addr === "string") throw new Error("missing listener");
  const proxy = await startWorkflowCallbackProxy({ targetUrl: `http://127.0.0.1:${addr.port}`, secret: key, port: 0 });
  try {
    expect((await fetch(`${proxy.baseUrl}/health`, { method: "POST" })).status).toBe(404);
    expect(seen).not.toHaveBeenCalled();
    expect((await fetch(`${proxy.baseUrl}/.well-known/workflow/v1/flow`, {
      method: "POST", body: "{}", headers: { "x-workflow-internal-key": "forged" },
    })).status).toBe(200);
    expect(seen).toHaveBeenCalledWith(key);
  } finally {
    await proxy.close();
    await new Promise<void>(resolve => target.close(() => resolve()));
  }
});
