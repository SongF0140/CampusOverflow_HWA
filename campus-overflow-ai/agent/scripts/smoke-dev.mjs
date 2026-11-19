import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { build, createDevServer, createNitro, prepare } from "nitro/builder";

Object.assign(process.env, { KNOWLEDGE_ROOT: "", WEEKLY_REPORT_ENABLED: "false", MODERATION_PATROL_ENABLED: "false",
  GOVERNANCE_EXECUTOR_ENABLED: "false", MCP_SERVER_ENABLED: "false", WORKFLOW_RUNTIME_ENABLED: "false" });
const socket = createServer();
socket.listen(0, "127.0.0.1");
await once(socket, "listening");
const port = socket.address().port;
await new Promise(resolve => socket.close(resolve));
const base = `http://127.0.0.1:${port}`;
const nitro = await createNitro({ dev: true, buildDir: ".nitro-dev-smoke", workflow: { dirs: ["src/workflows"], dashboard: false } });
try {
  await prepare(nitro);
  const dev = createDevServer(nitro);
  dev.listen({ port, hostname: "127.0.0.1" });
  await build(nitro);
  let isReady = false;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try { isReady = (await fetch(`${base}/health`, { signal: AbortSignal.timeout(1000) })).ok; }
    catch { /* 有限等待开发worker完成编译。 */ }
    if (isReady) break;
    await delay(100);
  }
  assert.ok(isReady, "Nitro dev health not ready");
  assert.equal((await fetch(`${base}/agent/health`)).status, 200);
  assert.equal((await fetch(`${base}/agent/chat`, { method: "POST", body: "{}" })).status, 401);
  assert.equal((await fetch(`${base}/.well-known/workflow/v1/flow`, { method: "POST" })).status, 404);
  console.log("Nitro dev smoke passed: health/auth and default-off workflow routes.");
} finally {
  await nitro.close();
}
