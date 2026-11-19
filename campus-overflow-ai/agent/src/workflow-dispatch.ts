import { start, getRun } from "workflow/api";
import { z } from "zod";
import { createWorkflowClient, RootSchema } from "./workflow-client.js";
import { governanceWorkflow } from "./workflows/governance.js";

export const dispatchGovernanceTask = async (target: { target_type: string; target_id: number }) => {
  if (process.env.GOVERNANCE_WORKFLOW_ENABLED !== "true" || process.env.WORKFLOW_RUNTIME_ENABLED !== "true") throw new Error("workflow_dispatch_disabled");
  const client = createWorkflowClient();
  const root = RootSchema.parse(await client.request("", target));
  if (root.workflow_run_id || root.status !== "active") return;
  await start(governanceWorkflow, [root.task_id]);
};
export const resumeUnboundGovernanceTasks = async () => {
  if (process.env.GOVERNANCE_WORKFLOW_ENABLED !== "true") return;
  if (process.env.WORKFLOW_RUNTIME_ENABLED !== "true") throw new Error("workflow_runtime_disabled");
  const client = createWorkflowClient();
  let cursor: string | null = null;
  do {
    const page = z.object({ items: z.array(RootSchema), next_cursor: z.string().nullable().default(null) })
      .parse(await client.request(`?scope=all${cursor ? `&after_task_id=${encodeURIComponent(cursor)}` : ""}`));
    for (const root of page.items) {
      try {
        if (!root.workflow_run_id) await start(governanceWorkflow, [root.task_id]);
        else {
          const status = await getRun(root.workflow_run_id).status;
          if (status === "failed" || status === "cancelled") await client.request(`/${root.task_id}/reconcile`, {
            workflow_run_id: root.workflow_run_id, status,
          });
        }
      } catch { console.error(JSON.stringify({ event: "patrol_root_reconcile_failed", task_id: root.task_id })); }
    }
    if (page.next_cursor === cursor && cursor !== null) throw new Error("workflow_cursor_stalled");
    cursor = page.next_cursor;
  } while (cursor);
};
