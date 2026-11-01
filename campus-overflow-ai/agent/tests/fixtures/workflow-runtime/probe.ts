import { WorkflowAgent } from "@ai-sdk/workflow";
import { createGovernanceLoopState } from "../../../src/loop/governance-loop-state.js";

export async function runtimeProbe(taskId: string) {
  "use workflow";
  return initializeCheckpoint(taskId);
}

async function initializeCheckpoint(taskId: string) {
  "use step";
  return { checkpoint: createGovernanceLoopState({ task_id: taskId, trace_id: "wf-runtime-smoke" }),
    workflow_agent_available: typeof WorkflowAgent === "function" };
}
