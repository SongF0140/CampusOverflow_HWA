import { expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpToolRegistry } from "../src/mcp/registry.js";
import { attachMcpToolHandlers } from "../src/mcp/server.js";
import { ensurePrivateContextMcpTools } from "../src/mcp/private-contexts.js";
import { createInternalClient } from "../src/internal-client.js";
import type { McpCallAuditRecord } from "../src/mcp/audit.js";

it("中台会话走后端来源认证，正文不进入MCP审计", async () => {
  const registry = new McpToolRegistry();
  const secret = "私人讨论内容不应进入审计";
  const calls: string[] = [];
  ensurePrivateContextMcpTools(registry, () => createInternalClient({ baseUrl: "http://backend", token: "service", externalKey: "external-a",
    fetchImpl: async (url, init) => {
      calls.push(new URL(String(url)).pathname);
      expect(new Headers(init?.headers).get("x-external-agent-key")).toBe("external-a");
      return Response.json({ code: 200, message: "ok", data: String(url).endsWith("principal")
        ? { user_id: 1, role: "admin", status: "active", identity_type: "undergraduate", assistant_cert_status: "none" }
        : { id: crypto.randomUUID(), title: "我的会话", messages: [{ role: "user", text: secret }], version: 1 } });
    } }));
  expect(registry.listTools().some(tool => /memory|approve|execute/.test(tool.name))).toBe(false);
  const records: McpCallAuditRecord[] = [];
  const server = attachMcpToolHandlers({ registry, principal: { name: "external", scopes: ["admin:act"] }, audit: { record: item => records.push(item) } });
  const client = new Client({ name: "test", version: "1" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(a), server.connect(b)]);
  try {
    const response = await client.callTool({ name: "create_private_session", arguments: { title: "我的会话", messages: [{ role: "user", text: secret }] } });
    expect(response.isError).toBe(false);
    expect(JSON.stringify(records)).not.toContain(secret);
    expect(calls).toEqual(["/internal/agent/external/principal", "/internal/agent/user/private-context/sessions"]);
  } finally { await client.close(); await server.close(); }
});
