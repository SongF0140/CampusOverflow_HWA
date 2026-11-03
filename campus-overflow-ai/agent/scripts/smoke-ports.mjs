import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { createServer } from "node:net";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { applyRuntimeEnvironment } from "./runtime-env.mjs";
import { resolveWorkflowRuntimeConfig, startWorkflowCallbackProxy } from "../src/runtime/postgres-runtime.ts";

const freePort = async () => {
  const server = createServer(); server.listen(0, "127.0.0.1"); await once(server, "listening");
  const address = server.address(); assert.ok(address && typeof address !== "string");
  await new Promise(resolve => server.close(resolve)); return String(address.port);
};
for (const mode of ["direct-nitro", "preload-nitro", "preload-agent"]) {
  const port = await freePort(); const other = await freePort();
  const env = { ...process.env, DOTENV_CONFIG_PATH: resolve(".env.example"), NITRO_PORT: mode === "preload-agent" ? other : port,
    AGENT_PORT: mode === "preload-agent" ? port : undefined, PORT: other,
    HOST: "127.0.0.1", NITRO_HOST: "127.0.0.1", NODE_ENV: "production", KNOWLEDGE_ROOT: "",
    WORKFLOW_RUNTIME_ENABLED: "false", GOVERNANCE_WORKFLOW_ENABLED: "false", GOVERNANCE_EXECUTOR_ENABLED: "false",
    MODERATION_PATROL_ENABLED: "false", WEEKLY_REPORT_ENABLED: "false", MCP_SERVER_ENABLED: "false" };
  const preload = mode !== "direct-nitro";
  const args = [...(preload ? ["--import", pathToFileURL(resolve("scripts/runtime-env.mjs")).href] : []), resolve(".output/server/index.mjs")];
  const child = spawn(process.execPath, args, { env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  let proxy; let output = "";
  child.stdout.on("data", data => { output = (output + data).slice(-4000); });
  child.stderr.on("data", data => { output = (output + data).slice(-4000); });
  try {
    let ready = false;
    for (let i = 0; i < 100; i += 1) {
      assert.equal(child.exitCode, null, output);
      try { if ((await fetch(`http://127.0.0.1:${port}/agent/health`, { signal: AbortSignal.timeout(500) })).ok) { ready = true; break; } }
      catch { /* 等待本脚本启动的服务就绪。 */ }
      await delay(100);
    }
    assert.ok(ready, output);
    const proxyEnv = { ...env }; if (preload) applyRuntimeEnvironment(proxyEnv);
    const config = resolveWorkflowRuntimeConfig({ ...proxyEnv, WORKFLOW_RUNTIME_ENABLED: "true",
      WORKFLOW_TARGET_WORLD: "@workflow/world-postgres", WORKFLOW_POSTGRES_URL: "postgres://test@127.0.0.1/test", WORKFLOW_CALLBACK_PORT: "0" });
    assert.equal(config?.kind, "postgres"); assert.equal(config.targetPort, port);
    proxy = await startWorkflowCallbackProxy({ targetUrl: `http://127.0.0.1:${config.targetPort}`, port: 0, secret: randomBytes(32).toString("hex") });
    const response = await fetch(proxy.baseUrl + "/.well-known/workflow/v1/flow", { method: "POST", body: "{}", signal: AbortSignal.timeout(5000) });
    assert.equal(response.status, 404); // 真实Nitro关闭的handler可达，不是连错端口的503。
    console.log(`Port smoke passed: ${mode}`);
  } finally {
    await proxy?.close();
    if (child.exitCode === null && child.signalCode === null) { const exited = once(child, "exit"); child.kill(); await exited; }
  }
}
