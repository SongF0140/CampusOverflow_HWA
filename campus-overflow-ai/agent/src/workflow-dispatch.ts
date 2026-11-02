import { start } from "workflow/api";
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
  const { items } = z.object({ items: z.array(RootSchema) }).parse(await createWorkflowClient().request(""));
  for (const root of items) await start(governanceWorkflow, [root.task_id]);
};
