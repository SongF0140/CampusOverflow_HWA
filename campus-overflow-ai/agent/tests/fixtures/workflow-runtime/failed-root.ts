import { getWorkflowMetadata } from "workflow";
import { bindGovernanceTask } from "../../../src/workflows/governance-steps.js";

export async function failedRoot(taskId: string) {
  "use workflow";
  await bindGovernanceTask(taskId, getWorkflowMetadata().workflowRunId);
  throw new Error("wf05_fixture_runtime_failure");
}
