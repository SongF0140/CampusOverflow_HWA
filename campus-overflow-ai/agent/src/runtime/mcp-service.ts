import { createInternalClient, resolveInternalConfig } from "../internal-client.js";
import { consoleMcpCallAudit } from "../mcp/audit.js";
import { startMcpHttpServer } from "../mcp/http.js";
import { loadMcpClients } from "../mcp/policy.js";
import { McpToolRegistry } from "../mcp/registry.js";
import { createMcpSessionFactory } from "../mcp/session.js";
import { ensureReadOnlyMcpTools } from "../mcp/tools.js";
import { ensureAdminMcpTools } from "../mcp/admin-tools.js";
import { ensurePrivateContextMcpTools } from "../mcp/private-contexts.js";
import { asTraceId } from "../types/index.js";

export const startMcpService = async (): Promise<() => void | Promise<void>> => {
  if (process.env.MCP_SERVER_ENABLED !== "true") return () => {};
  const clients = loadMcpClients(process.env.MCP_EXTERNAL_CLIENTS);
  const registry = new McpToolRegistry();
  ensureReadOnlyMcpTools(registry, createInternalClient({ ...resolveInternalConfig(), fetchImpl: fetch }));
  const externalClient = (name: string) => {
    const client = clients.find(item => item.name === name);
    if (!client) throw new Error("外部客户端已撤销");
    return createInternalClient({ ...resolveInternalConfig(), externalKey: client.token, fetchImpl: fetch });
  };
  ensureAdminMcpTools(registry, externalClient);
  ensurePrivateContextMcpTools(registry, externalClient);
  try {
    const handle = await startMcpHttpServer({
      clients,
      sessionFactory: createMcpSessionFactory({ registry, audit: consoleMcpCallAudit(), authorize: async principal => {
        if (!principal.scopes.some(scope => scope.startsWith("admin:"))) return;
        const client = clients.find(item => item.name === principal.name);
        if (!client) throw new Error("外部客户端已撤销");
        await externalClient(client.name).resolvePrincipal(asTraceId(`mcp-auth-${crypto.randomUUID()}`));
      } }),
      audit: consoleMcpCallAudit(),
    }, Number(process.env.MCP_PORT ?? 8790));
    console.log(`mcp server listening on http://localhost:${handle.port}/mcp`);
    return handle.close;
  } catch (error) {
    console.error(JSON.stringify({ event: "mcp_server_start_failed", reason: error instanceof Error ? error.name : "unknown" }));
    return () => {};
  }
};
