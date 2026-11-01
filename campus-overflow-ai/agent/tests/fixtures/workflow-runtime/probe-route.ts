import { randomUUID } from "node:crypto";
import { defineHandler } from "nitro";
import { start } from "workflow/api";
import { runtimeProbe } from "./probe.js";

// 仅冒烟构建注册该路由，正式构建不包含测试入口。
export default defineHandler(async () => {
  const run = await start(runtimeProbe, [randomUUID()]);
  return { run_id: run.runId, ...await run.returnValue };
});
