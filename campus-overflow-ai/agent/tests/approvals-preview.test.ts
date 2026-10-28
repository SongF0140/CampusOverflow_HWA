// AP-02A：真实路由和客户端，只替换后端 HTTP；任何写入或模型调用都使测试失败。
import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createApp } from "../src/app.js";
import { createInternalClient } from "../src/internal-client.js";
import { asTraceId } from "../src/types/index.js";

const serviceToken = randomUUID();
const authorization = `Bearer ${randomUUID()}`;
const input = { target_type: "question", target_id: 7, action: "hide", reason: "建议人工核查" };
let role: string;
let state: unknown;
let stateStatus: number;
let calls: Array<{ path: string; method: string; headers: Headers }>;
const getModel = vi.fn(() => { throw new Error("预览不得调用模型"); });

const fetchImpl = vi.fn<typeof fetch>(async (url, init) => {
  const path = new URL(String(url)).pathname;
  const method = init?.method ?? "GET";
  calls.push({ path, method, headers: new Headers(init?.headers) });
  if (method !== "GET") throw new Error("预览不得写入后端");
  if (path === "/internal/agent/principal") return Response.json({
    code: 200, message: "ok", data: {
      user_id: 3, role, status: "active", identity_type: "undergraduate", assistant_cert_status: "none",
    },
  });
  if (!path.startsWith("/internal/agent/user/governance-targets/")) throw new Error("非白名单请求");
  return Response.json({
    code: stateStatus, message: stateStatus === 200 ? "ok" : "backend-private-detail",
    data: stateStatus === 200 ? state : null,
  }, { status: stateStatus });
});

const makeApp = () => createApp({
  getModel,
  createClient: (auth, signal) => createInternalClient({
    baseUrl: "http://backend.test", token: serviceToken, authorization: auth, signal, fetchImpl,
  }),
});

const preview = (body: unknown = input, authenticated = true) => makeApp().request(
  "/agent/approvals/preview", {
    method: "POST", headers: {
      "content-type": "application/json", "x-trace-id": "preview-trace",
      ...(authenticated ? { authorization } : {}),
    }, body: JSON.stringify(body),
  },
);

beforeEach(() => {
  role = "admin";
  state = { target_type: "question", target_id: 7, current_state: "ready" };
  stateStatus = 200;
  calls = [];
  getModel.mockClear();
  fetchImpl.mockClear();
});

describe("管理员治理预览", () => {
  it("读取后端事实并提供拟动作影响，不建单、不执行、不调用模型", async () => {
    const response = await preview();
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.data).toMatchObject({
      ...input, current_state: "ready", can_request_approval: true,
      requires_confirmation: true, executed: false, trace_id: "preview-trace",
    });
    expect(result.data.effect).toContain("隐藏");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(calls.map(call => call.path)).toEqual([
      "/internal/agent/principal", "/internal/agent/user/governance-targets/question/7/state",
    ]);
    for (const call of calls) {
      expect(call.method).toBe("GET");
      expect(call.headers.get("x-service-token")).toBe(serviceToken);
      expect(call.headers.get("authorization")).toBe(authorization);
      expect(call.headers.get("x-trace-id")).toBe("preview-trace");
    }
    expect(getModel).not.toHaveBeenCalled();
  });

  it("未登录时不访问后端", async () => {
    expect((await preview(input, false)).status).toBe(401);
    expect(calls).toHaveLength(0);
  });

  it.each(["student", "teacher"])("后端身份为 %s 时不得读取治理状态", async value => {
    role = value;
    expect((await preview()).status).toBe(403);
    expect(calls.map(call => call.path)).toEqual(["/internal/agent/principal"]);
    expect(getModel).not.toHaveBeenCalled();
  });

  it.each([
    { target_type: "unknown" }, { target_id: 0 }, { target_id: "7" }, { action: "execute" },
    { reason: " " }, { reason: "x".repeat(501) }, { role: "admin" }, { user_id: 1 },
    { tool_name: "deleteAll" }, { duration_days: 7 },
    { target_type: "user", action: "hide" }, { action: "ban" },
  ])("拒绝非法输入 %j，且不查目标", async patch => {
    expect((await preview({ ...input, ...patch })).status).toBe(400);
    expect(calls).toHaveLength(1);
  });

  it.each([
    ["question", "hidden", "hide", false], ["question", "hidden", "delete", true],
    ["answer", "ready", "delete", true], ["comment", "ready", "hide", true],
    ["answer", "deleted", "delete", false], ["comment", "missing", "hide", false],
    ["user", "active", "ban", true], ["user", "active", "warn", true],
    ["user", "banned", "ban", false], ["user", "missing", "warn", false],
  ])("%s / %s / %s 的状态策略", async (targetType, currentState, action, allowed) => {
    state = { target_type: targetType, target_id: 7, current_state: currentState };
    const response = await preview({ ...input, target_type: targetType, action });
    expect(response.status).toBe(200);
    const { data } = await response.json();
    expect(data.can_request_approval).toBe(allowed);
    expect(data.executed).toBe(false);
    if (!allowed) expect(data.blocked_reason).toBeTruthy();
    expect(calls.every(call => call.method === "GET")).toBe(true);
  });

  it.each([undefined, 1, 30])("临时封禁期限 %s 规范化", async days => {
    state = { target_type: "user", target_id: 7, current_state: "active" };
    const response = await preview({
      ...input, target_type: "user", action: "ban_temp",
      ...(days === undefined ? {} : { duration_days: days }),
    });
    expect(response.status).toBe(200);
    expect((await response.json()).data.duration_days).toBe(days ?? 7);
  });

  it.each([0, 31, 1.5, "7"])("拒绝非法临时封禁期限 %s", async days => {
    expect((await preview({
      ...input, target_type: "user", action: "ban_temp", duration_days: days,
    })).status).toBe(400);
    expect(calls).toHaveLength(1);
  });

  it.each([
    { target_type: "question", target_id: 8, current_state: "ready" },
    { target_type: "answer", target_id: 7, current_state: "ready" },
    { target_type: "question", target_id: 7, current_state: "active" },
    { target_type: "question", target_id: 7, current_state: "approved" },
  ])("拒绝不匹配或非法的后端状态 %j", async invalidState => {
    state = invalidState;
    expect((await preview()).status).toBe(503);
    expect(calls).toHaveLength(2);
  });

  it.each([401, 403])("状态查询时后端撤权 %s，不降级、不泄漏原因", async status => {
    stateStatus = status;
    const response = await preview();
    expect(response.status).toBe(status);
    expect(await response.text()).not.toContain("backend-private-detail");
    expect(calls).toHaveLength(2);
  });

  it("拒绝无用户凭证的服务客户端读取管理员状态", async () => {
    const client = createInternalClient({ baseUrl: "http://backend.test", token: serviceToken, fetchImpl });
    await expect(client.fetchGovernanceTargetState(
      { targetType: "question", targetId: 7 }, asTraceId("preview-trace"),
    )).rejects.toMatchObject({ status: 401 });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("错误 JSON 不进入目标查询", async () => {
    const response = await makeApp().request("/agent/approvals/preview", {
      method: "POST", headers: { authorization, "content-type": "application/json" }, body: "{",
    });
    expect(response.status).toBe(400);
    expect(calls).toHaveLength(1);
  });
});
