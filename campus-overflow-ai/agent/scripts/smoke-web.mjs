import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { cp, mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { build, createNitro, prepare } from "nitro/builder";

const artifact = await mkdtemp(join(tmpdir(), "campus-web-artifact-"));
let child; let output = "";
try {
  const nitro = await createNitro({ output: { dir: ".output-web-smoke" }, buildDir: ".nitro-web-smoke",
    routes: { "/__web_probe": "./tests/fixtures/web-runtime/probe-route.ts" } });
  try { await prepare(nitro); await build(nitro); } finally { await nitro.close(); }
  await cp(resolve(".output-web-smoke"), artifact, { recursive: true });
  const portServer = createServer(); portServer.listen(0, "127.0.0.1"); await once(portServer, "listening");
  const port = String(portServer.address().port); await new Promise(resolve => portServer.close(resolve));
  child = spawn(process.execPath, ["--import", resolve("scripts/runtime-env.mjs"), join(artifact, "server/index.mjs")], {
    cwd: artifact, windowsHide: true, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env,
      NODE_ENV: "production", AGENT_PORT: port, HOST: "127.0.0.1", NITRO_HOST: "127.0.0.1",
      KNOWLEDGE_ROOT: "", WEEKLY_REPORT_ENABLED: "false", MODERATION_PATROL_ENABLED: "false",
      GOVERNANCE_EXECUTOR_ENABLED: "false", GOVERNANCE_WORKFLOW_ENABLED: "false", WORKFLOW_RUNTIME_ENABLED: "false",
      MCP_SERVER_ENABLED: "false", WEB_SEARCH_ENABLED: "false", WEB_BROWSER_ENABLED: "false" },
  });
  child.stdout.on("data", data => { output = (output + data).slice(-8000); });
  child.stderr.on("data", data => { output = (output + data).slice(-8000); });
  const base = `http://127.0.0.1:${port}`;
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`Artifact server exited: ${output}`);
    try { if ((await fetch(`${base}/agent/health`)).ok) { ready = true; break; } } catch { /* 仅等待本脚本进程的就绪窗口。 */ }
    await delay(200);
  }
  assert.ok(ready, `Artifact server not ready: ${output}`);
  const response = await fetch(`${base}/__web_probe`, { signal: AbortSignal.timeout(40_000) });
  assert.equal(response.status, 200, output);
  const result = await response.json();
  assert.equal(result.url, "https://example.com/public-reference");
  assert.ok(result.content.includes("BROWSER_ARTIFACT_SMOKE"));
  assert.ok(!result.content.includes("SCRIPT_MUST_BE_REMOVED"));
  console.log("Web smoke passed: standalone artifact, real agent-browser read and private-session cleanup.");
} finally {
  if (child && child.exitCode === null && child.signalCode === null) { const exited = once(child, "exit"); child.kill(); await exited; }
  await rm(artifact, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
