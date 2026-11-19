import { createServer, type Server } from "node:http";
import { once } from "node:events";
import { afterEach, expect, it, vi } from "vitest";
import { resolveWorkflowRuntimeConfig, startWorkflowRuntime } from "../src/runtime/postgres-runtime.js";
import { applyRuntimeEnvironment } from "../scripts/runtime-env.mjs";

const { world } = vi.hoisted(() => ({ world: { start: vi.fn(), close: vi.fn() } }));
vi.mock("workflow/runtime", () => ({ getWorld: async () => world, setWorld: vi.fn() }));
vi.mock("@workflow/world-postgres", () => ({ createWorld: () => world }));
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });
const pg = { WORKFLOW_RUNTIME_ENABLED: "true", WORKFLOW_TARGET_WORLD: "@workflow/world-postgres", WORKFLOW_POSTGRES_URL: "postgres://test@127.0.0.1/test" };

it("直接启动按Nitro优先级选择端口，不自行应用AGENT_PORT", () => {
  expect(resolveWorkflowRuntimeConfig({ ...pg, AGENT_PORT: "8100", PORT: "8101", NITRO_PORT: "8102" })?.targetPort).toBe("8102");
  expect(resolveWorkflowRuntimeConfig({ ...pg, PORT: "8101" })?.targetPort).toBe("8101");
  expect(resolveWorkflowRuntimeConfig(pg)?.targetPort).toBe("3000");
});
it("标准预加载仍优先AGENT_PORT并保留8787默认", () => {
  const env = { ...pg, AGENT_PORT: "8100", NITRO_PORT: "8102", PORT: "8101" };
  applyRuntimeEnvironment(env);
  expect(resolveWorkflowRuntimeConfig(env)?.targetPort).toBe("8100");
  const defaults = { ...pg }; applyRuntimeEnvironment(defaults);
  expect(resolveWorkflowRuntimeConfig(defaults)?.targetPort).toBe("8787");
});
it.each([{ NITRO_PORT: "0" }, { NITRO_PORT: "80oops" }, { NITRO_PORT: "65536" },
  { NITRO_UNIX_SOCKET: "/tmp/nitro.sock" }, { NITRO_PORT: "8788" }])("不支持的监听配置明确拒绝 %j", extra => {
  expect(() => resolveWorkflowRuntimeConfig({ ...pg, ...extra })).toThrow();
});
const listen = async (server: Server) => {
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const address = server.address(); if (!address || typeof address === "string") throw Error("No port");
  return String(address.port);
};
it("启动级真实代理在PORT冲突时仍转发至Nitro端口", async () => {
  const seen = vi.fn(); const wrongSeen = vi.fn();
  const target = createServer((req, res) => { seen(req.headers["x-workflow-internal-key"]); res.end("target"); });
  const wrong = createServer((_req, res) => { wrongSeen(); res.writeHead(418).end(); });
  const actualPort = await listen(target); const otherPort = await listen(wrong);
  for (const [key, value] of Object.entries({ ...pg, NITRO_PORT: actualPort, PORT: otherPort,
    WORKFLOW_CALLBACK_PORT: "0", WORKFLOW_LOCAL_BASE_URL: "", WORKFLOW_CALLBACK_SECRET: "" })) vi.stubEnv(key, value);
  let close: Awaited<ReturnType<typeof startWorkflowRuntime>> | undefined;
  try {
    close = await startWorkflowRuntime();
    const response = await fetch(process.env.WORKFLOW_LOCAL_BASE_URL + "/.well-known/workflow/v1/flow", { method: "POST", body: "{}" });
    expect(response.status).toBe(200); expect(await response.text()).toBe("target");
    expect(wrongSeen).not.toHaveBeenCalled();
    expect(seen).toHaveBeenCalledWith(process.env.WORKFLOW_CALLBACK_SECRET);
  } finally {
    await close?.();
    await Promise.all([new Promise<void>(resolve => target.close(() => resolve())), new Promise<void>(resolve => wrong.close(() => resolve()))]);
  }
});
