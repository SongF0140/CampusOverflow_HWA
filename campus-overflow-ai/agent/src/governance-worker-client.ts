import { z } from "zod";
import { executeApprovedAction, validateClaim, validateReceipt, type ExecutionClaim } from "./tools/approved-actions.js";
import type { ExecutionWorkerClient } from "./scheduler/governance-executor.js";

export const createGovernanceWorkerClient = (options: {
  baseUrl: string; token: string; executorToken: string; signal?: AbortSignal; fetchImpl?: typeof fetch;
}): ExecutionWorkerClient<ExecutionClaim> => {
  const request = async (path: string, job?: ExecutionClaim, body?: unknown) => {
    if (!options.token || !options.executorToken || options.token === options.executorToken) throw new Error("executor_not_configured");
    const response = await (options.fetchImpl ?? fetch)(new URL(`/internal/agent/governance-executions${path}`, options.baseUrl), {
      method: body ? "POST" : "GET", redirect: "error",
      headers: { "Content-Type": "application/json", "X-Service-Token": options.token, "X-Executor-Token": options.executorToken,
        ...(job ? { "X-Execution-Lease": job.lease, "X-Execution-Epoch": String(job.lease_epoch), "X-Trace-Id": job.trace_id } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(60_000)]) : AbortSignal.timeout(60_000),
    });
    if (!response.ok) throw new Error(`executor_http_${response.status}`);
    return z.object({ code: z.literal(200), data: z.unknown() }).parse(await response.json()).data;
  };
  return {
    claim: async () => { const data = await request("/claim", undefined, {}); return data === null ? null : validateClaim(data); },
    read: async job => {
      const state = z.object({ execution_id: z.string(), state: z.string(), executed: z.boolean(), receipt: z.unknown().nullable() })
        .parse(await request(`/${job.execution_id}`, job));
      if (state.execution_id !== job.execution_id || state.executed !== (state.receipt !== null)) throw new Error("receipt_state_mismatch");
      return { ...state, receipt: state.receipt === null ? null : validateReceipt(state.receipt, job) };
    },
    execute: job => executeApprovedAction(job,
      () => request(`/${job.execution_id}/execute`, job, { lease_epoch: job.lease_epoch }),
      { source: "approved_worker", traceId: job.trace_id, signal: options.signal,
        approvedExecution: { executionId: job.execution_id, argsHash: job.args_hash, leaseEpoch: job.lease_epoch } }),
    report: (job, outcome) => request(`/${job.execution_id}/report`, job, { lease_epoch: job.lease_epoch, outcome }),
  };
};
