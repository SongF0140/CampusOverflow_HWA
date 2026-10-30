import { RESULT_CHECK_DELAYS, waitForCheck, type ContinuationOutcome } from "../approvals/continuation.js";
import { checkHook } from "../security/hooks.js";
import type { SecurityHooks } from "../security/contracts.js";

export interface ExecutionWorkerClient<C extends { execution_id: string }> {
  claim(): Promise<C | null>;
  read(claim: C): Promise<{ executed: boolean; receipt?: unknown }>;
  execute(claim: C): Promise<unknown>;
  report(claim: C, outcome: ContinuationOutcome): Promise<unknown>;
}

/** 仅恢复确定性的核对/反馈；不恢复模型栈，也不继承下一动作的批准。 */
export const runGovernanceJob = async <C extends { execution_id: string }>(
  client: ExecutionWorkerClient<C>, options: { hooks?: SecurityHooks; signal?: AbortSignal; wait?: typeof waitForCheck } = {},
): Promise<void> => {
  const job = await client.claim();
  if (!job) return;
  await checkHook(options.hooks, { stage: "beforeResume", source: "approved_worker", toolName: "verify_result",
    input: { execution_id: job.execution_id }, traceId: job.execution_id });
  let outcome: ContinuationOutcome = "result_unknown";
  try {
    const current = await client.read(job);
    if (current.executed && current.receipt) outcome = "completed";
    else {
      try { await client.execute(job); } catch { /* 请求结果由原任务回执核对，不能据异常重做。 */ }
      for (const delay of RESULT_CHECK_DELAYS) {
        await (options.wait ?? waitForCheck)(delay, options.signal);
        try {
          const state = await client.read(job);
          if (state.executed && state.receipt) { outcome = "completed"; break; }
        } catch { /* 读取失败仍是未知，受固定核对次数限制。 */ }
      }
    }
  } catch { /* 首次读取失败不启动处置，留给人工核对。 */ }
  await client.report(job, outcome);
};

export const startGovernanceExecutor = (
  createClient: (signal: AbortSignal) => ExecutionWorkerClient<{ execution_id: string }>,
  enabled = process.env.GOVERNANCE_EXECUTOR_ENABLED === "true",
): (() => void) => {
  if (!enabled) return () => {};
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let controller: AbortController | undefined;
  const tick = async () => {
    if (stopped) return;
    controller = new AbortController();
    const deadline = setTimeout(() => controller?.abort(), 180_000);
    try { await runGovernanceJob(createClient(controller.signal), { signal: controller.signal }); }
    catch { console.error(JSON.stringify({ event: "governance_worker_pending_verification" })); }
    finally { clearTimeout(deadline); if (!stopped) timer = setTimeout(() => void tick(), 5_000); }
  };
  void tick();
  return () => { stopped = true; clearTimeout(timer); controller?.abort(); };
};
