import { defineHandler } from "nitro";
import { getRun, start } from "workflow/api";
import { z } from "zod";
import { governanceWorkflow } from "../../../src/workflows/governance.js";
import { failedRoot } from "./failed-root.js";
import { resumeUnboundGovernanceTasks } from "../../../src/workflow-dispatch.js";

// 仅验收构建注册；正式配置不包含此入口。
export default defineHandler(async event => {
  if (event.req.method === "POST") {
    const body = await event.req.json();
    if (body.mode === "reconcile") { await resumeUnboundGovernanceTasks(); return { reconciled: true }; }
    const { task_id } = z.object({ task_id: z.uuid() }).parse(body);
    const run = await start(body.mode === "failed_root" ? failedRoot : governanceWorkflow, [task_id]);
    return { run_id: run.runId };
  }
  const id = z.string().startsWith("wrun_").parse(event.url.searchParams.get("run_id"));
  const run = getRun(id); const status = await run.status;
  return { status, ...(status === "completed" ? { result: await run.returnValue } : {}) };
});
