import { describe, it, expect } from "vitest";
import { McpToolRegistry } from "../src/mcp/registry.js";
import { ensureAdminMcpTools } from "../src/mcp/admin-tools.js";
import { createInternalClient } from "../src/internal-client.js";
import { attachMcpToolHandlers } from "../src/mcp/server.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { loadMcpClients } from "../src/mcp/policy.js";

describe("外部管理员 MCP", () => {
  it("外部管理员继承教学提议和查询，但不提供确认/发布工具", () => {
    const registry = new McpToolRegistry();
    ensureAdminMcpTools(registry, () => ({}) as never);
    const names = registry.listTools().map(tool => tool.name);
    expect(names).toEqual(expect.arrayContaining(["request_class_membership", "read_class_membership_result", "propose_teaching_experience"]));
    expect(names.some(name => /confirm|publish|approve/.test(name))).toBe(false);
  });
  it("继承的名单工具走双凭证内部申请，返回等待确认而非执行", async () => {
    const id = crypto.randomUUID();
    const paths: string[] = [];
    const registry = new McpToolRegistry();
    ensureAdminMcpTools(registry, () => createInternalClient({ baseUrl: "https://backend.test", token: "service",
      externalKey: "fixture-external", fetchImpl: async (url, init) => {
        expect(new Headers(init?.headers).get("x-external-agent-key")).toBe("fixture-external");
        const path = new URL(String(url)).pathname;
        paths.push(path);
        return Response.json({ code: 200, message: "ok", data: path.endsWith("principal")
          ? { user_id: 1, role: "admin", status: "active", identity_type: "undergraduate", assistant_cert_status: "none" }
          : { request_id: id, course_id: 2, course_name: "课程", action: "add", status: "pending", executed: false,
            requires_confirmation: true, expires_at: "2026-11-05T00:00:00", trace_id: "mcp",
            students: [{ user_id: 7, username: "学生", role: "student", status: "active", joined: false }] } });
      } }));
    const tool = registry.getTool("request_class_membership")!;
    const input = { request_id: id.toUpperCase(), course_id: 2, student_ids: [7], action: "add" };
    const result = await tool.execute(tool.validate(input), { clientName: "external", traceId: "mcp-test", signal: new AbortController().signal });
    expect(result).toMatchObject({ executed: false, requires_confirmation: true });
    expect(paths).toEqual(["/internal/agent/external/principal", "/internal/agent/user/class-changes"]);
    expect(() => tool.validate({ ...input, confirmed: true })).toThrow();
  });
  it("后台验证密钥映射且只开放查询、申请、结果，不提供人工确认工具", async () => {
    const paths: string[] = [];
    const registry = new McpToolRegistry();
    ensureAdminMcpTools(registry, () => createInternalClient({
      baseUrl: "https://backend.test", token: "service", externalKey: "fixture-external", fetchImpl: async (url, init) => {
        expect(new Headers(init?.headers).get("x-external-agent-key")).toBe("fixture-external");
        const path = new URL(String(url)).pathname;
        paths.push(path);
        return Response.json({ code: 200, message: "ok", data: path.endsWith("principal")
          ? { user_id: 1, role: "admin", status: "active", identity_type: "undergraduate", assistant_cert_status: "none" }
          : { target_type: "question", target_id: 1, current_state: "ready", state_version: "a".repeat(64) } });
      },
    }));
    const tool = registry.getTool("preview_governance")!;
    const result = await tool.execute(tool.validate({ target_type: "question", target_id: 1, action: "hide", reason: "核查" }),
      { clientName: "external", traceId: "mcp-test", signal: new AbortController().signal });
    expect(result).toMatchObject({ executed: false, requires_confirmation: true });
    expect(paths[0]).toBe("/internal/agent/external/principal");
    expect(registry.listTools().map(t => t.name)).not.toContain("resolve_governance");
  });

  const connect = async (scopes: string[]) => {
    const paths: string[] = [];
    let revoked = false;
    const registry = new McpToolRegistry();
    ensureAdminMcpTools(registry, () => createInternalClient({
      baseUrl: "https://backend.test", token: "service", externalKey: "fixture-external",
      fetchImpl: async (url, init) => {
        const headers = new Headers(init?.headers);
        expect(headers.get("x-service-token")).toBe("service");
        expect(headers.get("x-external-agent-key")).toBe("fixture-external");
        expect(headers.get("authorization")).toBeNull();
        const path = new URL(String(url)).pathname;
        paths.push(path);
        if (revoked) return Response.json({ code: 403, message: "private-key", data: null }, { status: 403 });
        return Response.json({ code: 200, message: "ok", data: path.endsWith("principal")
          ? { user_id: 1, role: "admin", status: "active", identity_type: "undergraduate", assistant_cert_status: "none" }
          : { target_type: "question", target_id: 1, current_state: "ready", state_version: "a".repeat(64) } });
      },
    }));
    const server = attachMcpToolHandlers({ registry, principal: { name: "external", scopes }, audit: { record: () => undefined } });
    const client = new Client({ name: "admin-test", version: "1" });
    const [left, right] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(right), client.connect(left)]);
    return { client, paths, revoke: () => { revoked = true; } };
  };
  const preview = { target_type: "question", target_id: 1, action: "hide", reason: "核查" };

  it("每次调用复核当前后端身份，撤权后拒绝且不泄漏底层密钥", async () => {
    const { client, paths, revoke } = await connect(["admin:query"]);
    try {
      expect((await client.callTool({ name: "preview_governance", arguments: preview })).isError).toBe(false);
      revoke();
      const denied = await client.callTool({ name: "preview_governance", arguments: preview });
      expect(denied.isError).toBe(true);
      expect(JSON.stringify(denied)).not.toContain("private-key");
      expect(paths.filter(path => path.endsWith("principal"))).toHaveLength(2);
      expect(paths.filter(path => path.includes("governance-targets"))).toHaveLength(1);
    } finally { await client.close(); }
  });

  it("查询scope不能建单，普通read不能调用管理员查询；无人工批准工具", async () => {
    const query = await connect(["admin:query"]);
    try {
      const result = await query.client.callTool({ name: "request_governance", arguments: {
        ...preview, request_id: "00000000-0000-4000-8000-000000000001", expected_version: "a".repeat(64),
      } });
      expect(result.isError).toBe(true);
      expect(query.paths).toEqual([]);
      expect((await query.client.callTool({ name: "resolve_governance", arguments: {} })).isError).toBe(true);
    } finally { await query.client.close(); }
    const read = await connect(["read"]);
    try {
      expect((await read.client.callTool({ name: "preview_governance", arguments: preview })).isError).toBe(true);
      expect(read.paths).toEqual([]);
    } finally { await read.client.close(); }
  });

  it("重复名称或非法scope配置拒绝启动", () => {
    expect(() => loadMcpClients(JSON.stringify([
      { name: "same", token: "first", scopes: ["read"] },
      { name: "same", token: "second", scopes: ["admin:act"] },
    ]))).toThrow();
    expect(() => loadMcpClients(JSON.stringify([{ name: "x", token: "a", scopes: ["human:approve"] }]))).toThrow();
  });
});
