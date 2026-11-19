import { describe, it, expect } from "vitest";
import { createApp } from "../src/app.js";
import { createInternalClient } from "../src/internal-client.js";

describe("持久审批续接", () => {
  const id = "00000000-0000-4000-8000-000000000001";
  it("传递双凭证并仅调用结果接口，不执行治理", async () => {
    const paths: string[] = [];
    const app = createApp({ createClient: authorization => createInternalClient({
      baseUrl: "https://backend.test", token: "service", authorization,
      fetchImpl: async (url, init) => {
        const path = new URL(String(url)).pathname;
        paths.push(path);
        expect(new Headers(init?.headers).get("authorization")).toBe("Bearer user");
        expect(new Headers(init?.headers).get("x-service-token")).toBe("service");
        return Response.json({ code: 200, message: "ok", data: path.endsWith("principal")
          ? { user_id: 1, role: "admin", status: "active", identity_type: "undergraduate", assistant_cert_status: "none" }
          : { request_id: id, case_id: 1, state: "completed", executed: true,
            case_status: "executed", result: { case_status: "executed", resolution: "hide", executed: true }, expires_at: null,
            agent_run_id: `approval-${id}`, trace_id: "wait" } });
      },
    }) });
    const response = await app.request(`/agent/approvals/requests/${id}/resume`, {
      method: "POST", headers: { authorization: "Bearer user" },
    });
    expect(response.status).toBe(200);
    expect((await response.json()).data.state).toBe("completed");
    expect(paths).toEqual(["/internal/agent/principal", `/internal/agent/user/governance-requests/${id}/resume`]);
  });

  const makeApp = (patch: Record<string, unknown> = {}, status = 200, role = "admin") => {
    const paths: string[] = [];
    const app = createApp({ createClient: authorization => createInternalClient({
      baseUrl: "https://backend.test", token: "service", authorization,
      fetchImpl: async (url) => {
        const path = new URL(String(url)).pathname;
        paths.push(path);
        if (path.endsWith("principal")) return Response.json({ code: 200, message: "ok", data: {
          user_id: 1, role, status: "active", identity_type: "undergraduate", assistant_cert_status: "none",
        } });
        return Response.json({ code: status, message: "private-upstream-credential", data: status === 200 ? {
          request_id: id, case_id: 1, state: "completed", executed: true, case_status: "executed",
          result: { case_status: "executed", resolution: "hide", executed: true }, expires_at: null,
          agent_run_id: `approval-${id}`, trace_id: "wait", ...patch,
        } : null }, { status });
      },
    }) });
    return { app, paths };
  };

  it.each([401, 403, 409])("后端拒绝%s时保留状态且脱敏，不重试治理", async status => {
    const { app, paths } = makeApp({}, status);
    const response = await app.request(`/agent/approvals/requests/${id}/resume`, {
      method: "POST", headers: { authorization: "Bearer user" },
    });
    expect(response.status).toBe(status);
    expect(await response.text()).not.toContain("private-upstream-credential");
    expect(paths).toHaveLength(2);
  });

  it.each([
    { request_id: "00000000-0000-4000-8000-000000000002" },
    { agent_run_id: "wrong-run" },
    { executed: false },
    { result: null },
    { state: "waiting", case_status: "pending", executed: true },
  ])("拒绝响应ID或执行状态错配%j", async patch => {
    const { app } = makeApp(patch);
    const response = await app.request(`/agent/approvals/requests/${id}/resume`, {
      method: "POST", headers: { authorization: "Bearer user" },
    });
    expect(response.status).toBe(503);
  });

  it("取消后的历史反馈可保持未执行，即使之后工单被人类执行", async () => {
    const { app } = makeApp({ state: "cancelled", result: {
      case_status: "pending", resolution: null, executed: false,
    } });
    const response = await app.request(`/agent/approvals/requests/${id}`, {
      headers: { authorization: "Bearer user" },
    });
    expect(response.status).toBe(200);
    expect((await response.json()).data).toMatchObject({ state: "cancelled", executed: true,
      result: { executed: false } });
  });

  it("非管理员在本地拒绝，非法标识不访问后端等待接口", async () => {
    const student = makeApp({}, 200, "student");
    expect((await student.app.request(`/agent/approvals/requests/${id}`, {
      headers: { authorization: "Bearer user" },
    })).status).toBe(403);
    expect(student.paths).toEqual(["/internal/agent/principal"]);
    const invalid = makeApp();
    expect((await invalid.app.request("/agent/approvals/requests/not-a-uuid", {
      headers: { authorization: "Bearer user" },
    })).status).toBe(400);
    expect(invalid.paths).toEqual(["/internal/agent/principal"]);
  });
});
