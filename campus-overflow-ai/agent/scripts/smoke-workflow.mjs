import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { build, createNitro, prepare } from "nitro/builder";

const freePort = async () => {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return String(port);
};
const dataDir = await mkdtemp(join(tmpdir(), "campus-workflow-smoke-"));
const fixture = "./tests/fixtures/workflow-runtime/";
let child;
let output = "";
const stopChild = async () => {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, "exit");
  child.kill();
  await exited;
};
const request = (base, path, init) => fetch(`${base}${path}`, { ...init, signal: AbortSignal.timeout(20_000) });

try {
  const nitro = await createNitro({
    output: { dir: ".output-smoke" }, buildDir: ".nitro-smoke",
    workflow: { dirs: [fixture], dashboard: false },
    routes: { "/__workflow_probe": `${fixture}probe-route.ts`, "/__runtime_close": `${fixture}close-route.ts` },
  });
  try { await prepare(nitro); await build(nitro); } finally { await nitro.close(); }
  for (const enabled of [false, true]) {
    const port = await freePort();
    const mcpPort = await freePort();
    const base = `http://127.0.0.1:${port}`;
    output = "";
    child = spawn(process.execPath, ["--import", "./scripts/runtime-env.mjs", ".output-smoke/server/index.mjs"], {
      cwd: process.cwd(), windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, NODE_ENV: enabled ? "test" : "production", AGENT_PORT: port,
        NITRO_HOST: "127.0.0.1", HOST: "127.0.0.1", KNOWLEDGE_ROOT: "",
        WEEKLY_REPORT_ENABLED: "false", MODERATION_PATROL_ENABLED: "false", GOVERNANCE_EXECUTOR_ENABLED: "false",
        MCP_SERVER_ENABLED: "true", MCP_PORT: mcpPort,
        MCP_EXTERNAL_CLIENTS: JSON.stringify([{ name: "smoke", token: randomUUID(), scopes: ["read"] }]),
        WORKFLOW_RUNTIME_ENABLED: String(enabled), WORKFLOW_TARGET_WORLD: "@workflow/world-local",
        WORKFLOW_LOCAL_DATA_DIR: dataDir, WORKFLOW_LOCAL_BASE_URL: base,
      },
    });
    child.stdout.on("data", chunk => { output = (output + chunk).slice(-12000); });
    child.stderr.on("data", chunk => { output = (output + chunk).slice(-12000); });
    child.on("error", error => { output += error.message; });
    let isReady = false;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if (child.exitCode !== null) throw new Error(`Smoke server exited: ${output}`);
      try { isReady = (await request(base, "/health")).ok; } catch { /* 启动阶段有限等待。 */ }
      if (isReady) break;
      await delay(100);
    }
    assert.ok(isReady, `Smoke server not ready: ${output}`);
    assert.equal((await request(base, "/agent/health")).status, 200);
    assert.equal((await request(base, "/agent/chat", { method: "POST", body: "{}" })).status, 401);
    assert.equal((await fetch(`http://127.0.0.1:${mcpPort}/mcp`)).status, 401);
    assert.equal(output.split("mcp server listening").length - 1, 1);
    if (enabled) {
      const response = await request(base, "/__workflow_probe");
      const result = await response.json();
      assert.equal(response.status, 200, JSON.stringify(result));
      assert.ok(result.run_id);
      assert.equal(result.workflow_agent_available, true);
      assert.equal(result.checkpoint.round, 1);
      assert.equal(result.checkpoint.phase, "acting");
      assert.equal(result.checkpoint.trace_id, "wf-runtime-smoke");
    } else {
      assert.equal((await request(base, "/.well-known/workflow/v1/flow", { method: "POST" })).status, 404);
    }
    assert.equal((await request(base, "/__runtime_close")).status, 200);
    await assert.rejects(fetch(`http://127.0.0.1:${mcpPort}/mcp`));
    await stopChild();
  }
  console.log("Workflow smoke passed: health/auth, default-off routes, real workflow/step, MCP start once and close.");
} catch (error) {
  if (output) console.error(output);
  throw error;
} finally {
  await stopChild();
  // 只删除本脚本mkdtemp创建并持有的临时目录，不处理项目或用户目录。
  assert.equal(resolve(dirname(dataDir)), resolve(tmpdir()));
  assert.ok(basename(dataDir).startsWith("campus-workflow-smoke-"));
  await rm(dataDir, { recursive: true, force: true });
}
