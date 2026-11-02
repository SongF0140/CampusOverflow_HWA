import { createHash } from "node:crypto";
import { z } from "zod";
import { createWorkflowClient, RootSchema, ObservationSchema, WorkflowApiError } from "../workflow-client.js";
import type { GovernanceAction, GovernanceObservation } from "../loop/governance-workflow-loop.js";

const timed = async <T>(call: () => Promise<T>) => {
  const started = Date.now(); const value = await call();
  return { value, active_ms: Date.now() - started };
};
export async function bindGovernanceTask(taskId: string, runId: string) {
  "use step";
  return RootSchema.parse(await createWorkflowClient().request(`/${taskId}/bind`, { workflow_run_id: runId }));
}
export async function observeGovernanceTask(taskId: string) {
  "use step";
  return timed(() => createWorkflowClient().observe(taskId));
}
export async function proposeGovernanceAction(taskId: string, round: number, index: number, action: GovernanceAction, observed: GovernanceObservation) {
  "use step";
  return timed(async () => {
    const client = createWorkflowClient();
    const current = ObservationSchema.parse(observed);
    if (current.task_id !== taskId || !current.content_complete) throw new Error("workflow_observation_mismatch");
    const bytes = createHash("sha256").update(`${taskId}:${round}:${index}`).digest().subarray(0, 16);
    bytes[6] = (bytes[6]! & 15) | 64; bytes[8] = (bytes[8]! & 63) | 128;
    const hex = bytes.toString("hex");
    const requestId = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    const target = ["hide", "delete"].includes(action.action) ? current.content : current.author;
    if (!target) throw new Error("workflow_author_missing");
    let raw;
    try {
      raw = await client.request(`/${taskId}/proposals`, { request_id: requestId, round, ...action,
        expected_version: target.state_version, expected_content_version: current.content.state_version });
    } catch (error) {
      if (error instanceof WorkflowApiError && [400, 409, 422].includes(error.status)) {
        return { ok: false as const, code: error.status === 409 ? "target_changed" as const : "action_invalid" as const };
      }
      throw error;
    }
    const item = z.object({ request_id: z.uuid() }).parse(raw);
    if (item.request_id !== requestId) throw new Error("workflow_request_mismatch");
    return { ok: true as const, request_id: requestId };
  });
}
export async function readGovernanceApproval(taskId: string, requestId: string) {
  "use step";
  return { value: z.object({ request_id: z.literal(requestId), status: z.string() })
    .parse(await createWorkflowClient().request(`/${taskId}/proposals/${requestId}`)).status, active_ms: 0 };
}
export async function executeGovernanceAction(taskId: string, requestId: string) {
  "use step";
  return timed(() => createWorkflowClient().execute(taskId, requestId));
}
export async function finishGovernanceTask(taskId: string, status: "completed" | "needs_human", reason: string) {
  "use step";
  await createWorkflowClient().request(`/${taskId}/finish`, { status, reason });
}
