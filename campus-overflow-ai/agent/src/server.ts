// Agent 服务入口：Hono + Node 运行时，端口 8787（与前端 rewrites 对应）
import "dotenv/config";

import { serve } from "@hono/node-server";

import { createApp } from "./app.js";
import { createInternalClient, resolveInternalConfig } from "./internal-client.js";
import { startWeeklyReportScheduler } from "./scheduler/weekly-report.js";

const app = createApp();
const port = Number(process.env.AGENT_PORT ?? 8787);

serve({ fetch: app.fetch, port }, (info) => {
  // 控制台日志使用英文（见 .trae/rules/coding-style.md）
  console.log(`agent service listening on http://localhost:${info.port}`);
});

// 教师周报调度（KN-R02）：服务级系统运行；WEEKLY_REPORT_ENABLED=false 可停用
const stopWeeklyReports = startWeeklyReportScheduler({
  createClient: () => createInternalClient({ ...resolveInternalConfig(), fetchImpl: fetch }),
});

process.on("SIGTERM", () => {
  stopWeeklyReports();
  process.exit(0);
});
