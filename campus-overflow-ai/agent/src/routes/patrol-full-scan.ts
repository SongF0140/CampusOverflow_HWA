// 管理员全量扫描：默认关闭、仅 active 管理员；创建后进程内后台分批执行，只建单不处置。
// 执行权不靠进程内状态：先向后端原子认领，只有拿到 fencing token 的实例才启动执行器。
import { randomUUID } from "node:crypto";
import type { Context } from "hono";
import { z } from "zod";

import type { AgentEnvironment } from "../auth/request-context.js";
import {
  createInternalClient, InternalApiError, resolveInternalConfig,
  type PatrolScanClaim, type PatrolScanTargetType,
} from "../internal-client.js";
import { runFullScanJob } from "../scheduler/full-scan.js";
import { toErrorResponse, type AgentApp } from "./support.js";

const CreateSchema = z.object({
  target_types: z.array(z.enum(["question", "answer", "comment"])).min(1).max(3).optional(),
}).strict();
const JobIdSchema = z.coerce.number().int().positive();

// 租约 120 秒：首轮审计与注入上下文可能较慢，续租按同一时长顺延
const CLAIM_LEASE_SECONDS = 120;
// 每个 Agent 进程一个 worker_id；执行权仍由后端 token 判定，进程号只用于审计定位
const WORKER_ID = (process.env.AGENT_WORKER_ID ?? `agent-${randomUUID()}`).slice(0, 64);

export interface PatrolFullScanOptions {
  /** 测试注入：认领成功后如何启动后台执行 */
  startScan?: (jobId: number, claim: PatrolScanClaim) => void;
}

const isEnabled = (): boolean => (process.env.PATROL_FULL_SCAN_ENABLED ?? "false") === "true";

const denied = (c: Context<AgentEnvironment>) => {
  if (!isEnabled()) {
    return c.json({ code: 503, data: null, message: "全量扫描未启用" }, 503);
  }
  const principal = c.get("principal");
  if (principal.role !== "admin" || principal.status !== "active") {
    return c.json({ code: 403, data: null, message: "仅管理员可发起全量扫描" }, 403);
  }
  return null;
};

const failure = (c: Context<AgentEnvironment>, error: unknown) => {
  if (error instanceof InternalApiError && (error.status === 404 || error.status === 409)) {
    const message = error.status === 404 ? "扫描任务不存在" : "扫描任务状态不允许当前操作";
    return c.json({ code: error.status, data: null, message }, error.status);
  }
  const mapped = toErrorResponse(error);
  return c.json({ code: mapped.status, data: null, message: mapped.message }, mapped.status);
};

// 进程内去重只是本地优化：真正的执行锁在后端 claim
const activeJobs = new Set<number>();

/** 本进程是否已在执行该任务（用于 resume 幂等返回，不承担跨实例互斥） */
export const isFullScanRunning = (jobId: number): boolean => activeJobs.has(jobId);

const defaultStart = (jobId: number, claim: PatrolScanClaim): void => {
  if (activeJobs.has(jobId)) return;
  activeJobs.add(jobId);
  const client = createInternalClient({ ...resolveInternalConfig(), fetchImpl: fetch });
  void runFullScanJob({
    jobId, client, workerToken: claim.worker_token, leaseSeconds: CLAIM_LEASE_SECONDS,
  })
    .catch((error: unknown) => {
      console.error(JSON.stringify({
        event: "full_scan_failed", job_id: jobId,
        reason: error instanceof Error ? error.name : "unknown",
      }));
    })
    .finally(() => { activeJobs.delete(jobId); });
};

export const registerPatrolFullScanRoutes = (
  app: AgentApp, options: PatrolFullScanOptions = {},
): void => {
  const start = options.startScan ?? defaultStart;

  app.post("/agent/patrol/full-scan", async (c) => {
    c.header("cache-control", "no-store");
    const rejected = denied(c);
    if (rejected) return rejected;
    const parsed = CreateSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) {
      return c.json({ code: 400, data: null, message: "扫描范围参数不合法" }, 400);
    }
    try {
      const targetTypes = parsed.data.target_types
        ? [...new Set<PatrolScanTargetType>(parsed.data.target_types)]
        : undefined;
      const client = c.get("internalClient");
      const job = await client.createPatrolScan({
        targetTypes, createdBy: c.get("principal").user_id,
      }, c.get("traceId"));
      const claim = await client.claimPatrolScan({
        jobId: job.id, workerId: WORKER_ID, leaseSeconds: CLAIM_LEASE_SECONDS,
      }, c.get("traceId"));
      start(job.id, claim);
      return c.json({ code: 200, data: claim.job, message: "扫描任务已创建" });
    } catch (error) {
      return failure(c, error);
    }
  });

  app.get("/agent/patrol/full-scan/:jobId", async (c) => {
    c.header("cache-control", "no-store");
    const rejected = denied(c);
    if (rejected) return rejected;
    const jobId = JobIdSchema.safeParse(c.req.param("jobId"));
    if (!jobId.success) {
      return c.json({ code: 400, data: null, message: "扫描任务编号不合法" }, 400);
    }
    try {
      const job = await c.get("internalClient").getPatrolScan(jobId.data, c.get("traceId"));
      return c.json({ code: 200, data: job, message: "扫描任务状态" });
    } catch (error) {
      return failure(c, error);
    }
  });

  app.post("/agent/patrol/full-scan/:jobId/resume", async (c) => {
    c.header("cache-control", "no-store");
    const rejected = denied(c);
    if (rejected) return rejected;
    const jobId = JobIdSchema.safeParse(c.req.param("jobId"));
    if (!jobId.success) {
      return c.json({ code: 400, data: null, message: "扫描任务编号不合法" }, 400);
    }
    try {
      const client = c.get("internalClient");
      const job = await client.getPatrolScan(jobId.data, c.get("traceId"));
      if (job.status !== "queued" && job.status !== "running") {
        return c.json({ code: 409, data: null, message: "扫描任务已结束，不能续跑" }, 409);
      }
      if (isFullScanRunning(job.id)) {
        return c.json({ code: 200, data: job, message: "扫描任务已在执行" });
      }
      const claim = await client.claimPatrolScan({
        jobId: job.id, workerId: WORKER_ID, leaseSeconds: CLAIM_LEASE_SECONDS,
      }, c.get("traceId"));
      start(job.id, claim);
      return c.json({ code: 200, data: claim.job, message: "扫描任务已恢复" });
    } catch (error) {
      return failure(c, error);
    }
  });

  app.post("/agent/patrol/full-scan/:jobId/cancel", async (c) => {
    c.header("cache-control", "no-store");
    const rejected = denied(c);
    if (rejected) return rejected;
    const jobId = JobIdSchema.safeParse(c.req.param("jobId"));
    if (!jobId.success) {
      return c.json({ code: 400, data: null, message: "扫描任务编号不合法" }, 400);
    }
    try {
      const job = await c.get("internalClient").cancelPatrolScan(jobId.data, c.get("traceId"));
      return c.json({ code: 200, data: job, message: "扫描任务已取消" });
    } catch (error) {
      return failure(c, error);
    }
  });
};
