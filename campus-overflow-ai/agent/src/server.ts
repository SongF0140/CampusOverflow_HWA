// Agent 服务入口：Hono + Node 运行时，端口 8787（与前端 rewrites 对应）
import "dotenv/config";

import { serve } from "@hono/node-server";

import { createApp } from "./app.js";
import {
  createInternalClient,
  resolveInternalConfig,
} from "./internal-client.js";
import { consoleMcpCallAudit } from "./mcp/audit.js";
import { startMcpHttpServer } from "./mcp/http.js";
import { loadMcpClients } from "./mcp/policy.js";
import { McpToolRegistry } from "./mcp/registry.js";
import { createMcpSessionFactory } from "./mcp/session.js";
import { ensureReadOnlyMcpTools } from "./mcp/tools.js";
import { ensureAdminMcpTools } from "./mcp/admin-tools.js";
import { ensurePrivateContextMcpTools } from "./mcp/private-contexts.js";
import { startModerationPatrolScheduler } from "./scheduler/moderation-patrol.js";
import { startWeeklyReportScheduler } from "./scheduler/weekly-report.js";
import { asTraceId } from "./types/index.js";
import { getKnowledgeCatalog } from "./knowledge/runtime.js";
import { startGovernanceExecutor } from "./scheduler/governance-executor.js";
import { createGovernanceWorkerClient } from "./governance-worker-client.js";

const app = createApp();
const knowledgeCatalog = getKnowledgeCatalog();
void knowledgeCatalog?.start(Number(process.env.KNOWLEDGE_RECONCILE_MS ?? 60_000)).catch(() => {
  console.error(JSON.stringify({ event: "knowledge_catalog_start_failed" }));
});
const port = Number(process.env.AGENT_PORT ?? 8787);

serve({ fetch: app.fetch, port }, (info) => {
  // 控制台日志使用英文（见 .trae/rules/coding-style.md）
  console.log(`agent service listening on http://localhost:${info.port}`);
});

// 服务级系统调度（无用户 HTTP 语境）：
// 教师周报（KN-R02，WEEKLY_REPORT_ENABLED=false 可停用）与
// 内容静默巡检（US-13，MODERATION_PATROL_ENABLED=false 可停用）
const stopWeeklyReports = startWeeklyReportScheduler({
  createClient: () => createInternalClient({ ...resolveInternalConfig(), fetchImpl: fetch }),
});
const stopPatrol = startModerationPatrolScheduler({
  createClient: () => createInternalClient({ ...resolveInternalConfig(), fetchImpl: fetch }),
});
const stopGovernanceExecutor = startGovernanceExecutor(signal => createGovernanceWorkerClient({
  ...resolveInternalConfig(), executorToken: process.env.GOVERNANCE_EXECUTOR_TOKEN ?? "", signal,
}));

// MCP Server（T-17，Q-11）：对外只读信息同步入口，默认关闭；
// MCP_SERVER_ENABLED=true 且 MCP_EXTERNAL_CLIENTS 配置了大系统凭证后开启
let stopMcp: (() => void) | undefined;
if (process.env.MCP_SERVER_ENABLED === "true") {
  const clients = loadMcpClients(process.env.MCP_EXTERNAL_CLIENTS);
  const registry = new McpToolRegistry();
  ensureReadOnlyMcpTools(
    registry,
    createInternalClient({ ...resolveInternalConfig(), fetchImpl: fetch }),
  );
  const externalClient = (name: string) => {
    const client = clients.find(item => item.name === name);
    if (!client) throw new Error("外部客户端已撤销");
    return createInternalClient({ ...resolveInternalConfig(), externalKey: client.token, fetchImpl: fetch });
  };
  ensureAdminMcpTools(registry, externalClient);
  ensurePrivateContextMcpTools(registry, externalClient);
  startMcpHttpServer(
    {
      clients,
      sessionFactory: createMcpSessionFactory({ registry, audit: consoleMcpCallAudit(), authorize: async principal => {
        if (!principal.scopes.some(scope => scope.startsWith("admin:"))) return;
        const client = clients.find(item => item.name === principal.name);
        if (!client) throw new Error("外部客户端已撤销");
        await createInternalClient({ ...resolveInternalConfig(), externalKey: client.token, fetchImpl: fetch })
          .resolvePrincipal(asTraceId(`mcp-auth-${crypto.randomUUID()}`));
      } }),
      audit: consoleMcpCallAudit(),
    },
    Number(process.env.MCP_PORT ?? 8790),
  )
    .then((handle) => {
      stopMcp = handle.close;
      console.log(`mcp server listening on http://localhost:${handle.port}/mcp`);
    })
    .catch((error: unknown) => {
      console.error(JSON.stringify({
        event: "mcp_server_start_failed",
        reason: error instanceof Error ? error.name : "unknown",
      }));
    });
}

process.on("SIGTERM", () => {
  knowledgeCatalog?.stop();
  stopWeeklyReports();
  stopPatrol();
  stopGovernanceExecutor();
  stopMcp?.();
  process.exit(0);
});
