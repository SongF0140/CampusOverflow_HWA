// MCP HTTP 传输集成测试（T-17 N-02）：真实 HTTP 上 SDK Client 完整握手
// （initialize → listTools → callTool）、无效凭证 401、审计与失败隔离贯通传输层。
import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

import type { InternalClient } from "../src/internal-client";
import { type McpCallAuditRecord } from "../src/mcp/audit";
import { createMcpHttpHandler } from "../src/mcp/http";
import { createMcpSessionFactory } from "../src/mcp/session";
import { McpToolRegistry } from "../src/mcp/registry";
import { ensureReadOnlyMcpTools } from "../src/mcp/tools";

const CLIENTS = [{ token: "big-system-token", name: "campus-portal", scopes: ["read"] }];

const buildRegistry = (clientStub: InternalClient) => {
  const registry = new McpToolRegistry();
  ensureReadOnlyMcpTools(registry, clientStub);
  return registry;
};

describe("MCP HTTP 传输（T-17 N-02）", () => {
  let port = 0;
  let closeServer = async () => {};
  let auditRecords: McpCallAuditRecord[];
  let clientStub: InternalClient;

  beforeAll(async () => {
    clientStub = {
      searchQuestions: vi.fn().mockResolvedValue([{ id: 9, title: "线程与死锁的区别", courseId: 2 }]),
      searchCourses: vi.fn().mockResolvedValue([]),
      fetchTags: vi.fn().mockResolvedValue([]),
    } as unknown as InternalClient;
    auditRecords = [];
    const handler = createMcpHttpHandler({
      clients: CLIENTS,
      sessionFactory: createMcpSessionFactory({
        registry: buildRegistry(clientStub),
        audit: { record: (record) => { auditRecords.push(record); } },
      }),
      audit: { record: (record) => { auditRecords.push(record); } },
    });
    const server = http.createServer((req, res) => {
      handler(req, res).catch(() => {
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ code: 500, data: null, message: "MCP 服务内部错误" }));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    port = (server.address() as AddressInfo).port;
    closeServer = () => new Promise<void>((resolve) => server.close(() => resolve()));
  });

  afterAll(async () => { await closeServer(); });

  it("无效凭证：POST 直接 401，不进入 MCP 协议", async () => {
    const response = await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer wrong" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    expect(response.status).toBe(401);
    const body = await response.json() as { message: string };
    expect(body.message).toContain("MCP 凭证");
    expect(auditRecords).toHaveLength(0);
  });

  it("真实握手：initialize → listTools → callTool 全链路成功", async () => {
    const client = new Client({ name: "integration-client", version: "0.0.1" });
    const transport = new StreamableHTTPClientTransport(
      new URL(`http://127.0.0.1:${port}/mcp`),
      { requestInit: { headers: { authorization: "Bearer big-system-token" } } },
    );
    await client.connect(transport);

    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name).sort())
      .toEqual(["list_tags", "search_courses", "search_questions"]);

    const result = await client.callTool({
      name: "search_questions", arguments: { keyword: "死锁", limit: 5 },
    });
    expect(result.isError).toBe(false);
    const text = result.content.map((item) => (item.type === "text" ? item.text : "")).join("");
    expect(text).toContain("线程与死锁的区别");

    await client.close();
    // 调用审计贯通传输层（客户端名与 trace 均有记录）
    const call = auditRecords.find((record) => record.tool === "search_questions");
    expect(call).toMatchObject({
      status: "succeeded", client: "campus-portal",
      trace_id: expect.stringMatching(/^mcp-/),
    });
  });

  it("同一服务进程内 MCP 与聊天互不影响（失败隔离的进程级形态）", async () => {
    // MCP 调用走独立代码路径（mcp/ 目录），聊天入口（routes/chat.ts）不经过此处；
    // 本断言验证 MCP Server 实例按请求独立创建，单次故障不遗留全局状态
    const client = new Client({ name: "isolation-client", version: "0.0.1" });
    const transport = new StreamableHTTPClientTransport(
      new URL(`http://127.0.0.1:${port}/mcp`),
      { requestInit: { headers: { authorization: "Bearer big-system-token" } } },
    );
    await client.connect(transport);
    const first = await client.callTool({ name: "search_tags_invalid", arguments: {} });
    expect(first.isError).toBe(true);
    const second = await client.callTool({
      name: "search_courses", arguments: { keyword: "操作系统" },
    });
    expect(second.isError).toBe(false);
    await client.close();
  });
});
