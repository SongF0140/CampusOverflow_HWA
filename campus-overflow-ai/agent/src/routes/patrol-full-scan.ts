// 管理员全量扫描：默认关闭、仅 active 管理员；创建后进程内后台分批执行，只建单不处置。
import type { Context } from "hono";
import { z } from "zod";

import type { AgentEnvironment } from "../auth/request-context.js";
import {
  createInternalClient, InternalApiError, resolveInternalConfig,
  type PatrolScanTargetType,
} from "../internal-client.js";
import { runFullScanJob } from "../scheduler/full-scan.js";
import { toErrorResponse, type AgentApp } from "./support.js";

const CreateSchema = z.object({
  target_types: z.array(z.enum(["question", "answer", "comment"])).min(1).max(3).optional(),
}).strict();
const JobIdSchema = z.coerce.number().int().positive();

export interface PatrolFullScanOptions {
  /** 测试注入：创建任务后如何启动后台执行 */
  startScan?: (jobId: number) => void;
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

// 进程内去重：同一任务不重复启动执行器；进程重启后可经 resume 续跑
const activeJobs = new Set<number>();

const defaultStart = (jobId: number): void => {
  if (activeJobs.has(jobId)) return;
  activeJobs.add(jobId);
  const client = createInternalClient({ ...resolveInternalConfig(), fetchImpl: fetch });
  void runFullScanJob({ jobId, client })
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
      const job = await c.get("internalClient").createPatrolScan({
        targetTypes, createdBy: c.get("principal").user_id,
      }, c.get("traceId"));
      start(job.id);
      return c.json({ code: 200, data: job, message: "扫描任务已创建" });
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
      const job = await c.get("internalClient").getPatrolScan(jobId.data, c.get("traceId"));
      if (job.status !== "queued" && job.status !== "running") {
        return c.json({ code: 409, data: null, message: "扫描任务已结束，不能续跑" }, 409);
      }
      start(job.id);
      return c.json({ code: 200, data: job, message: "扫描任务已恢复" });
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
