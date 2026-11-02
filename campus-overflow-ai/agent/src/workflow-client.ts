import { z } from "zod";
import { resolveInternalConfig } from "./internal-client.js";
import { createGovernanceWorkerClient } from "./governance-worker-client.js";
import { ExecutionClaimSchema, validateClaim, validateReceipt } from "./tools/approved-actions.js";

export const ROOT_PATH = "/internal/agent/patrol/workflow-tasks";
export const RootSchema = z.object({ task_id: z.uuid(), trace_id: z.string(), workflow_run_id: z.string().nullable(), status: z.string() });
export const ObservationSchema = z.object({ task_id: z.uuid(), observation_ref: z.string(), excerpt: z.string().max(1000),
  content: z.object({ current_state: z.string(), state_version: z.string() }),
  author: z.object({ current_state: z.string(), state_version: z.string() }).nullable() });
const ProposalSchema = z.object({ request_id: z.uuid(), execution_id: z.uuid().nullable(), status: z.string(),
  case_id: z.number().int(), approved_by: z.number().int().nullable(), args_hash: z.string(), trace_id: z.string(),
  frozen_call: ExecutionClaimSchema.shape.frozen_call });

/** 仅服务端step/调度器使用；不注册模型工具或外部MCP。 */
export const createWorkflowClient = () => {
  const config = resolveInternalConfig();
  const executorToken = process.env.GOVERNANCE_EXECUTOR_TOKEN ?? "";
  const request = async (path: string, body?: unknown, executor = false): Promise<unknown> => {
    if (!config.token || (executor && (!executorToken || executorToken === config.token))) throw new Error("workflow_credentials_missing");
    const response = await fetch(new URL(ROOT_PATH + path, config.baseUrl), {
      method: body === undefined ? "GET" : "POST", redirect: "error", signal: AbortSignal.timeout(30_000),
      headers: { "content-type": "application/json", "x-service-token": config.token,
        ...(executor ? { "x-executor-token": executorToken } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!response.ok) throw new Error(`workflow_http_${response.status}`);
    return z.object({ code: z.literal(200), data: z.unknown() }).parse(await response.json()).data;
  };
  return { request,
    observe: async (taskId: string) => ObservationSchema.parse(await request(`/${taskId}/observe`)),
    execute: async (taskId: string, requestId: string): Promise<"executed" | "unknown"> => {
      const prefix = `/${taskId}/proposals/${requestId}`;
      const proposal = ProposalSchema.parse(await request(prefix));
      if (proposal.frozen_call.workflow_task_id !== taskId || proposal.request_id !== requestId) throw new Error("workflow_scope_mismatch");
      const receipt = await request(`${prefix}/receipt`);
      if (receipt !== null) {
        if (!proposal.execution_id || !proposal.approved_by) throw new Error("receipt_without_approval");
        validateReceipt(receipt, { ...proposal, execution_id: proposal.execution_id, approved_by: proposal.approved_by });
        return "executed";
      }
      const raw = await request(`${prefix}/claim`, {}, true);
      if (raw === null) return "unknown";
      const claim = validateClaim(raw);
      if (claim.request_id !== requestId || claim.frozen_call.workflow_task_id !== taskId) throw new Error("workflow_scope_mismatch");
      const worker = createGovernanceWorkerClient({ ...config, executorToken });
      try {
        await worker.execute(claim);
        await worker.report(claim, "completed");
        return "executed";
      } catch {
        // HTTP返回丢失或审计响应失败，只核对原execution；租约从不离开本step。
        const original = await worker.read(claim).catch(() => null);
        if (original?.executed) return "executed";
        await worker.report(claim, "result_unknown").catch(() => undefined);
        return "unknown";
      }
    },
  };
};
