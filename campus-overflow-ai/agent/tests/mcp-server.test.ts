// MCP 服务端核心测试（T-17 N-01，US-19 / Q-11）：白名单（未注册拒绝）、scope 策略、
// 调用审计（脱敏摘要）、后端故障隔离（isError 不崩会话）、ListTools 只列注册工具。
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

import type { InternalClient } from "../src/internal-client";
import {
  consoleMcpCallAudit,
  type McpCallAuditRecord,
} from "../src/mcp/audit";
import {
  authenticateClient,
  loadMcpClients,
  McpScopeDeniedError,
  assertCallAllowed,
} from "../src/mcp/policy";
import { McpToolRegistry, zodValidator } from "../src/mcp/registry";
import { attachMcpToolHandlers } from "../src/mcp/server";
import { ensureReadOnlyMcpTools } from "../src/mcp/tools";
import { z } from "zod";

const connectServer = async (
  options: { scopes?: string[]; clientName?: string } = {},
) => {
  const clientStub = {
    searchQuestions: vi.fn().mockResolvedValue([
      { id: 9, title: "线程与死锁的区别", courseId: 2 },
    ]),
    searchCourses: vi.fn().mockResolvedValue([{ id: 2, name: "操作系统", code: "CS101" }]),
    fetchTags: vi.fn().mockResolvedValue([{ id: 5, name: "并发", type: "tech" }]),
  } as unknown as InternalClient;
  const registry = new McpToolRegistry();
  ensureReadOnlyMcpTools(registry, clientStub);
  const auditRecords: McpCallAuditRecord[] = [];
  const audit = { record: (record: McpCallAuditRecord) => { auditRecords.push(record); } };
  const server = attachMcpToolHandlers({
    registry,
    principal: { name: options.clientName ?? "campus-portal", scopes: options.scopes ?? ["read"] },
    audit,
  });
  const client = new Client({ name: "test-client", version: "0.0.1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return { client, auditRecords, clientStub };
};

const callToolText = (result: CallToolResult): string =>
  result.content.map((item) => (item.type === "text" ? item.text : "")).join("");

beforeEach(() => { vi.restoreAllMocks(); });

describe("MCP 服务端：白名单与工具列表", () => {
  it("ListTools 只列注册表内的只读工具", async () => {
    const { client } = await connectServer();
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name).sort())
      .toEqual(["list_tags", "search_courses", "search_questions"]);
  });

  it("未注册工具不可被调用：isError 结果且不暴露注册表内容", async () => {
    const { client, auditRecords } = await connectServer();
    const result = await client.callTool({ name: "drop_all_tables", arguments: {} });
    expect(result.isError).toBe(true);
    expect(callToolText(result)).toContain("工具未注册");
    expect(callToolText(result)).not.toContain("search_questions");
    expect(auditRecords[0]).toMatchObject({
      status: "unregistered", tool: "drop_all_tables", client: "campus-portal",
    });
  });
});

describe("MCP 服务端：scope 策略", () => {
  it("read scope 客户端调用只读工具成功", async () => {
    const { client, clientStub, auditRecords } = await connectServer();
    const result = await client.callTool({
      name: "search_questions", arguments: { keyword: "死锁", limit: 5 },
    });
    expect(result.isError).toBe(false);
    expect(callToolText(result)).toContain("线程与死锁的区别");
    expect(clientStub.searchQuestions).toHaveBeenCalledWith(
      { keyword: "死锁", limit: 5 }, expect.stringMatching(/^mcp-/),
    );
    expect(auditRecords[0]).toMatchObject({
      status: "succeeded", tool: "search_questions",
      args_summary: expect.stringContaining("死锁"),
      result_summary: expect.stringContaining("线程与死锁"),
      trace_id: expect.stringMatching(/^mcp-/),
    });
  });

  it("scope 不足即拒绝（admin 工具对 read 客户端不可见可调面）", async () => {
    // 直接对策略函数断言：read 客户端调 admin:act 工具被拒
    const principal = { name: "campus-portal", scopes: ["read"] };
    expect(() => assertCallAllowed(principal, { name: "ban_user", scope: "admin:act" }))
      .toThrow(McpScopeDeniedError);
  });

  it("空 scope 客户端调用任何工具都被拒绝并留 denied 审计", async () => {
    const registry = new McpToolRegistry();
    registry.registerTool({
      name: "future_admin_tool",
      description: "后续批次的管理员工具占位（scope 预留验证）",
      scope: "admin:act",
      inputSchema: { type: "object" },
      validate: zodValidator(z.object({}).passthrough()),
      execute: async () => ({ done: true }),
    });
    const auditRecords: McpCallAuditRecord[] = [];
    const server = attachMcpToolHandlers({
      registry, principal: { name: "limited", scopes: [] },
      audit: { record: (record) => { auditRecords.push(record); } },
    });
    const client = new Client({ name: "test", version: "0.0.1" });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(st), client.connect(ct)]);
    // 管理员工具未接入前 ListTools 也会列出（注册即可见）；调用被 scope 拒绝
    const result = await client.callTool({ name: "future_admin_tool", arguments: {} });
    expect(result.isError).toBe(true);
    expect(callToolText(result)).toContain("admin:act");
    expect(auditRecords[0]?.status).toBe("denied");
  });
});

describe("MCP 服务端：审计与故障隔离", () => {
  it("入参与结果记录为脱敏摘要：密钥类内容不落审计原文", async () => {
    const clientStub = {
      searchQuestions: vi.fn().mockResolvedValue([{ id: 1, title: "正常标题" }]),
      searchCourses: vi.fn(), fetchTags: vi.fn(),
    } as unknown as InternalClient;
    const registry = new McpToolRegistry();
    ensureReadOnlyMcpTools(registry, clientStub);
    const auditRecords: McpCallAuditRecord[] = [];
    const server = attachMcpToolHandlers({
      registry, principal: { name: "campus-portal", scopes: ["read"] },
      audit: { record: (record) => { auditRecords.push(record); } },
    });
    const client = new Client({ name: "test", version: "0.0.1" });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(st), client.connect(ct)]);
    await client.callTool({
      name: "search_questions",
      arguments: { keyword: "数据库password=abc123 连接", limit: 3 },
    });
    expect(auditRecords[0]?.args_summary).not.toContain("abc123");
    expect(auditRecords[0]?.args_summary).toContain("[REDACTED]");
  });

  it("后端故障返回 isError 脱敏结果，会话可继续调用（失败隔离）", async () => {
    const clientStub = {
      searchQuestions: vi.fn().mockRejectedValue(new Error("backend 500: secret-reason")),
      searchCourses: vi.fn().mockResolvedValue([]),
      fetchTags: vi.fn().mockResolvedValue([]),
    } as unknown as InternalClient;
    const registry = new McpToolRegistry();
    ensureReadOnlyMcpTools(registry, clientStub);
    const auditRecords: McpCallAuditRecord[] = [];
    const server = attachMcpToolHandlers({
      registry, principal: { name: "campus-portal", scopes: ["read"] },
      audit: { record: (record) => { auditRecords.push(record); } },
    });
    const client = new Client({ name: "test", version: "0.0.1" });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(st), client.connect(ct)]);

    const failed = await client.callTool({
      name: "search_questions", arguments: { keyword: "x" },
    });
    expect(failed.isError).toBe(true);
    expect(callToolText(failed)).toContain("工具执行失败");
    expect(callToolText(failed)).not.toContain("secret-reason");
    expect(auditRecords[0]).toMatchObject({ status: "failed" });

    // 同会话后续调用不受影响（失败隔离）
    clientStub.searchQuestions = vi.fn().mockResolvedValue([{ id: 2, title: "恢复" }]);
    const recovered = await client.callTool({
      name: "search_questions", arguments: { keyword: "y" },
    });
    expect(recovered.isError).toBe(false);
    expect(callToolText(recovered)).toContain("恢复");
  });

  it("入参非法（schema 校验失败）返回 isError 并计 failed 审计", async () => {
    const { client, auditRecords } = await connectServer();
    const result = await client.callTool({
      name: "search_questions", arguments: { keyword: "" },
    });
    expect(result.isError).toBe(true);
    expect(auditRecords[0]?.status).toBe("failed");
  });
});

describe("MCP 客户端凭证策略（N-01 单元）", () => {
  const clients = [{ token: "big-system-token", name: "campus-portal", scopes: ["read"] }];

  it("有效 Bearer 凭证映射到客户端身份与 scopes", () => {
    expect(authenticateClient("Bearer big-system-token", clients))
      .toEqual({ name: "campus-portal", scopes: ["read"] });
  });

  it.each([
    [undefined, "缺失头"],
    ["", "空头"],
    ["Basic abc", "非 Bearer"],
    ["Bearer wrong-token", "错误凭证"],
    ["Bearer big-system-tokens", "前缀相同但更长"],
  ])("%s（%s）→ null", (authorization) => {
    expect(authenticateClient(authorization as string | undefined, clients)).toBeNull();
  });

  it("loadMcpClients：合法 JSON 解析；非法结构启动即失败", () => {
    expect(loadMcpClients(JSON.stringify(clients))).toEqual(clients);
    expect(() => loadMcpClients('[{"name":"x"}]')).toThrow();
    expect(() => loadMcpClients("not-json")).toThrow();
    expect(loadMcpClients(undefined)).toEqual([]);
  });

  it("console 审计实现输出结构化 JSON（含脱敏摘要）", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const audit = consoleMcpCallAudit();
    audit.record({
      event: "mcp_tool_call", client: "campus-portal", tool: "search_questions",
      status: "succeeded", args_summary: "关键词=[REDACTED]", result_summary: null,
      error_summary: null, duration_ms: 12, trace_id: "mcp-abc",
    });
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("mcp_tool_call"));
  });
});
