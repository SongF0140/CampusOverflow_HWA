import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile, realpath } from "node:fs/promises";
import { resolve } from "node:path";
import { Client } from "pg";
import { prepareReplayPayload } from "@workflow/core/serialization";
import { setTimeout as delay } from "node:timers/promises";
import { build, createNitro, prepare } from "nitro/builder";

const pgUrl = process.env.WORKFLOW_SMOKE_POSTGRES_URL;
assert.ok(pgUrl && new URL(pgUrl).hostname === "127.0.0.1" && new URL(pgUrl).port === "55432", "仅允许本次隔离PG实例");
const mysqlUrl = process.env.WORKFLOW_SMOKE_MYSQL_URL;
assert.ok(mysqlUrl?.includes("@127.0.0.1:53306/campus_wf04?"), "仅允许本次隔离MySQL库");
const serviceToken = randomUUID(), executorToken = randomUUID(), jwtSecret = randomUUID() + randomUUID();
const backendEnv = { ...process.env, BACKEND_DATABASE_URL: mysqlUrl, BACKEND_AGENT_SERVICE_TOKEN: serviceToken,
  BACKEND_GOVERNANCE_EXECUTOR_TOKEN: executorToken, BACKEND_GOVERNANCE_EXECUTOR_ENABLED: "true",
  BACKEND_GOVERNANCE_WORKFLOW_ENABLED: "true", BACKEND_JWT_SECRET: jwtSecret, PYTHONPATH: "." };
const freePort = async () => { const s = createServer(); s.listen(0, "127.0.0.1"); await once(s, "listening");
  const p = s.address().port; await new Promise(r => s.close(r)); return String(p); };
const children = new Set();
let log = "";
const launch = (exe, args, options) => { const p = spawn(exe, args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"], ...options });
  children.add(p); p.stdout.on("data", b => { log = (log + b).slice(-16000); }); p.stderr.on("data", b => { log = (log + b).slice(-16000); }); return p; };
const stop = async p => { if (!p || p.exitCode !== null || p.signalCode !== null) return;
  const done = once(p, "exit"); p.kill(); await done; children.delete(p); };
const request = async (url, init) => { const r = await fetch(url, { ...init, signal: AbortSignal.timeout(15000) });
  const text = await r.text(); assert.ok(r.ok, `${r.status} ${text.slice(0, 300)}`); return JSON.parse(text); };
const ready = async url => { for (let i = 0; i < 180; i++) { try { if ((await fetch(url)).ok) return; } catch {} await delay(200); }
  throw new Error("isolated server not ready"); };
let proxy, backend, agent;
try {
  const fixture = "./tests/fixtures/workflow-runtime/";
  if (process.env.WORKFLOW_SMOKE_SKIP_BUILD !== "true") {
  const nitro = await createNitro({ output: { dir: ".output-governance-smoke" }, buildDir: ".nitro-governance-smoke",
    workflow: { dirs: [fixture, "./src/workflows"], dashboard: false },
    routes: { "/__governance_probe": `${fixture}governance-route.ts`, "/__runtime_close": `${fixture}close-route.ts` } });
  try { await prepare(nitro); await build(nitro); } finally { await nitro.close(); }
  }
  const seedProc = spawn("../backend/.venv/Scripts/python.exe", ["tests/wf04_seed.py"], {
    cwd: "../backend", env: backendEnv, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  let seedOut = "", seedError = "";
  seedProc.stdout.on("data", b => { seedOut += b; }); seedProc.stderr.on("data", b => { seedError += b; });
  assert.equal((await once(seedProc, "exit"))[0], 0, seedError);
  const seed = JSON.parse(seedOut.trim());
  const backendPort = await freePort(), agentPort = await freePort();
  const backendBase = `http://127.0.0.1:${backendPort}`, agentBase = `http://127.0.0.1:${agentPort}`;
  backend = launch("../backend/.venv/Scripts/python.exe", ["-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", backendPort], { cwd: "../backend", env: backendEnv });
  await ready(`${backendBase}/health`);
  const modelCalls = [], proposals = new Map(), executionCalls = new Map();
  const secretCanaries = new Set([serviceToken, executorToken, seed.admin_token, "wf04-test-only-never-persist"]);
  let dropFirstReceipt = true;
  proxy = createServer((req, res) => { void (async () => {
    const chunks = []; for await (const c of req) chunks.push(c); const body = Buffer.concat(chunks);
    if (req.url.endsWith("/responses")) {
      const input = JSON.parse(body.toString());
      const user = input.input.findLast(m => m.role === "user");
      const prompt = JSON.parse(user.content.find(c => c.type === "input_text").text);
      modelCalls.push({ phase: prompt.phase, round: prompt.round });
      const output = prompt.phase === "plan" ? { actions: [0, 1].map(() => ({ action: "warn", reason: "隔离验收逐次批准", duration_days: null })) }
        : { decision: "continue", progress: true, evidence_refs: [prompt.observation.observation_ref] };
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ id: `resp_${randomUUID()}`, created_at: Math.floor(Date.now() / 1000), status: "completed", model: "test",
        output: [{ type: "message", id: "msg_test", role: "assistant", status: "completed", content: [{ type: "output_text", text: JSON.stringify(output), annotations: [] }] }],
        usage: { input_tokens: 10, output_tokens: 10, total_tokens: 20 } })); return;
    }
    const headers = new Headers(); for (const [k, v] of Object.entries(req.headers)) if (v && !["host", "connection", "content-length", "transfer-encoding"].includes(k)) headers.set(k, String(v));
    const r = await fetch(backendBase + req.url, { method: req.method, headers, body: body.length ? body : undefined });
    const text = await r.text();
    if (req.url.endsWith("/claim") && r.ok) {
      const lease = JSON.parse(text).data?.lease; if (lease) secretCanaries.add(lease);
    }
    if (req.url.endsWith("/proposals") && req.method === "POST" && r.ok) {
      const p = JSON.parse(text).data; proposals.set(p.request_id, p);
    }
    if (req.url.endsWith("/execute")) {
      executionCalls.set(req.url, (executionCalls.get(req.url) ?? 0) + 1);
      if (dropFirstReceipt && r.ok) { dropFirstReceipt = false; req.socket.destroy(); return; }
    }
    res.writeHead(r.status, { "content-type": "application/json" }); res.end(text);
  })().catch(() => { res.writeHead(500).end(); }); });
  proxy.listen(0, "127.0.0.1"); await once(proxy, "listening");
  const proxyBase = `http://127.0.0.1:${proxy.address().port}`;
  const agentEnv = { ...process.env, NODE_ENV: "test", AGENT_PORT: agentPort, NITRO_HOST: "127.0.0.1", HOST: "127.0.0.1",
    BACKEND_BASE_URL: proxyBase, AGENT_SERVICE_TOKEN: serviceToken, GOVERNANCE_EXECUTOR_TOKEN: executorToken,
    OPENAI_BASE_URL: `${proxyBase}/v1`, OPENAI_API_KEY: "wf04-test-only-never-persist",
    AGENT_MODEL_ID: "gpt-test", WORKFLOW_RUNTIME_ENABLED: "true", WORKFLOW_TARGET_WORLD: "@workflow/world-postgres",
    WORKFLOW_POSTGRES_URL: pgUrl, WORKFLOW_CALLBACK_PORT: "0", KNOWLEDGE_ROOT: "", MCP_SERVER_ENABLED: "false",
    MODERATION_PATROL_ENABLED: "false", WEEKLY_REPORT_ENABLED: "false", GOVERNANCE_EXECUTOR_ENABLED: "false", GOVERNANCE_WORKFLOW_ENABLED: "false" };
  const startAgent = async () => { agent = launch(process.execPath, ["--import", "./scripts/runtime-env.mjs", ".output-governance-smoke/server/index.mjs"], { env: agentEnv }); await ready(`${agentBase}/health`); };
  await startAgent();
  const serviceHeaders = { "content-type": "application/json", "x-service-token": serviceToken };
  const root = (await request(`${backendBase}/internal/agent/patrol/workflow-tasks`, { method: "POST", headers: serviceHeaders,
    body: JSON.stringify({ target_type: "question", target_id: seed.question_id }) })).data;
  const run = await request(`${agentBase}/__governance_probe`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ task_id: root.task_id }) });
  // 并发重复候选必须在绑定首步失败，不能获得任何治理动作。
  await request(`${agentBase}/__governance_probe`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ task_id: root.task_id }) });
  let restarted = false, result;
  const approved = new Set(); const deadline = Date.now() + 180000;
  while (Date.now() < deadline) {
    for (const p of proposals.values()) {
      if (approved.has(p.request_id)) continue;
      if (p.frozen_call.workflow_round === 3 && !restarted) {
        await delay(500); await stop(agent);
        if (process.env.WORKFLOW_SMOKE_PG_CTL) {
          const dataDir = await realpath("../.wf04-postgres-test");
          assert.equal(resolve(dataDir), resolve("../.wf04-postgres-test"));
          const control = async args => {
            // Windows的PG后台子进程会继承stdio；不要为短命pg_ctl创建持久读取管道。
            const controlProcess = spawn(process.env.WORKFLOW_SMOKE_PG_CTL, args, { windowsHide: true, stdio: "ignore" });
            assert.equal((await once(controlProcess, "exit"))[0], 0, "isolated Postgres control failed");
          };
          await control(["-D", dataDir, "-m", "fast", "-w", "stop"]);
          await control(["-D", dataDir, "-l", `${dataDir}/server.log`, "-o", "-p 55432 -h 127.0.0.1", "-w", "start"]);
        }
        await startAgent(); restarted = true;
        console.log("WF04: restarted while waiting in round 3");
      }
      if (approved.size === 0) { assert.equal(executionCalls.size, 0); console.log("WF04: zero execution before approval"); }
      await request(`${backendBase}/api/governance/approval-requests/${p.request_id}/approve`, {
        method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${seed.admin_token}` },
        body: JSON.stringify({ args_hash: p.args_hash, note: "仅隔离验收模拟逐次人工批准" }) });
      approved.add(p.request_id);
    }
    const current = await request(`${agentBase}/__governance_probe?run_id=${run.run_id}`);
    if (current.status === "completed") { result = current.result; break; }
    assert.notEqual(current.status, "failed", "workflow failed"); await delay(200);
  }
  assert.ok(result, "workflow timeout"); assert.equal(result.reason, "round_limit"); assert.equal(result.checkpoint.round, 5);
  assert.equal(approved.size, 10); assert.equal(executionCalls.size, 10); assert.ok([...executionCalls.values()].every(c => c === 1));
  assert.equal(modelCalls.length, 10); assert.equal(restarted, true); assert.equal(dropFirstReceipt, false);
  assert.deepEqual(modelCalls.filter(c => c.phase === "plan").map(c => c.round), [1, 2, 3, 4, 5]);
  const finalRoot = (await request(`${backendBase}/internal/agent/patrol/workflow-tasks/${root.task_id}`, { headers: serviceHeaders })).data;
  assert.equal(finalRoot.workflow_run_id, run.run_id); assert.equal(finalRoot.status, "needs_human");
  const pg = new Client({ connectionString: pgUrl }); await pg.connect();
  try {
    const { rows } = await pg.query("SELECT input, output, input_cbor, output_cbor, error_cbor FROM workflow.workflow_steps WHERE run_id=$1", [run.run_id]);
    assert.ok(rows.length > 10);
    for (const row of rows) for (const raw of Object.values(row)) {
      if (raw === null) continue;
      const value = Buffer.isBuffer(raw) ? (await prepareReplayPayload(raw)).data : raw;
      const text = value instanceof Uint8Array ? Buffer.from(value).toString("utf8") : JSON.stringify(value);
      for (const secret of secretCanaries) assert.ok(!text.includes(secret), "credential entered durable step data");
    }
  } finally { await pg.end(); }
  console.log(JSON.stringify({ event: "WF04 passed", rounds: 5, actions: approved.size, model_calls: modelCalls.length,
    restarted_round: 3, postgres_restarted: Boolean(process.env.WORKFLOW_SMOKE_PG_CTL),
    persisted_secret_canaries: 0, dropped_receipt_recovered: true, tool_calls: result.tool_calls }));
} catch (error) { await mkdir("../.wf04-integration", { recursive: true });
  await writeFile("../.wf04-integration/last-log.txt", log); console.error(log.slice(-3000)); throw error;
} finally { for (const p of children) await stop(p); await new Promise(resolve => proxy ? proxy.close(resolve) : resolve()); }
