// P2 全量扫描管理端：默认关闭、仅管理员、认领成功后启动后台执行、冲突映射。
import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AgentEnvironment } from "../src/auth/request-context";
import {
  InternalApiError, type PatrolScanClaim, type PatrolScanJob, type UserInternalClient,
} from "../src/internal-client";
import { registerPatrolFullScanRoutes } from "../src/routes/patrol-full-scan";

const WORKER_TOKEN = "worker-token-0123456789abcdef0123456789abcdef";

const jobOf = (overrides: Partial<PatrolScanJob> = {}): PatrolScanJob => ({
  id: 9, status: "queued", target_types: ["question"],
  cursor_type: null, cursor_id: null, scanned: 0, escalated: 0, skipped: 0, failed: 0,
  cancel_requested: false, created_by: 7, trace_id: "trace", error_summary: null,
  created_at: "2026-11-18T00:00:00", started_at: null, finished_at: null,
  ...overrides,
});

const claimOf = (overrides: Partial<PatrolScanJob> = {}): PatrolScanClaim => ({
  job: jobOf({ status: "running", started_at: "2026-11-18T00:00:01", ...overrides }),
  worker_token: WORKER_TOKEN,
  lease_expires_at: "2026-11-18T00:01:01",
});

const setup = (role: "student" | "admin", client: Partial<UserInternalClient>, startScan = vi.fn()) => {
  const app = new Hono<AgentEnvironment>();
  app.use("*", async (c, next) => {
    c.set("principal", {
      user_id: 7, role, status: "active", identity_type: "teacher",
      assistant_cert_status: "none",
    });
    c.set("internalClient", client as UserInternalClient);
    c.set("traceId", "trace-full-scan" as never);
    await next();
  });
  registerPatrolFullScanRoutes(app, { startScan });
  return { app, startScan };
};

afterEach(() => { vi.unstubAllEnvs(); });

describe("全量扫描管理端", () => {
  it("默认关闭返回 503", async () => {
    vi.stubEnv("PATROL_FULL_SCAN_ENABLED", "false");
    const { app } = setup("admin", {});
    expect((await app.request("/agent/patrol/full-scan/1")).status).toBe(503);
  });

  it("非管理员返回 403", async () => {
    vi.stubEnv("PATROL_FULL_SCAN_ENABLED", "true");
    const { app } = setup("student", {});
    const response = await app.request("/agent/patrol/full-scan", {
      method: "POST", headers: { "content-type": "application/json" }, body: "{}",
    });
    expect(response.status).toBe(403);
  });

  it("管理员创建任务并启动后台执行", async () => {
    vi.stubEnv("PATROL_FULL_SCAN_ENABLED", "true");
    const createPatrolScan = vi.fn().mockResolvedValue(jobOf());
    const claimPatrolScan = vi.fn().mockResolvedValue(claimOf());
    const { app, startScan } = setup("admin", { createPatrolScan, claimPatrolScan });
    const response = await app.request("/agent/patrol/full-scan", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ target_types: ["question", "question", "comment"] }),
    });
    expect(response.status).toBe(200);
    expect((await response.json()).data.id).toBe(9);
    expect(createPatrolScan).toHaveBeenCalledWith(
      { targetTypes: ["question", "comment"], createdBy: 7 }, "trace-full-scan",
    );
    expect(claimPatrolScan).toHaveBeenCalledWith(
      expect.objectContaining({ jobId: 9, leaseSeconds: 120 }), "trace-full-scan",
    );
    expect(startScan).toHaveBeenCalledWith(
      9, expect.objectContaining({ worker_token: WORKER_TOKEN }),
    );
  });

  it("认领失败时返回 409 且不启动执行器", async () => {
    vi.stubEnv("PATROL_FULL_SCAN_ENABLED", "true");
    const createPatrolScan = vi.fn().mockResolvedValue(jobOf());
    const claimPatrolScan = vi
      .fn()
      .mockRejectedValue(new InternalApiError(409, 409, "扫描任务已被其他 worker 认领"));
    const { app, startScan } = setup("admin", { createPatrolScan, claimPatrolScan });
    const response = await app.request("/agent/patrol/full-scan", {
      method: "POST", headers: { "content-type": "application/json" }, body: "{}",
    });
    expect(response.status).toBe(409);
    expect(startScan).not.toHaveBeenCalled();
  });

  it("非法范围返回 400 且不创建任务", async () => {
    vi.stubEnv("PATROL_FULL_SCAN_ENABLED", "true");
    const createPatrolScan = vi.fn();
    const { app } = setup("admin", { createPatrolScan });
    const response = await app.request("/agent/patrol/full-scan", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ target_types: ["user"] }),
    });
    expect(response.status).toBe(400);
    expect(createPatrolScan).not.toHaveBeenCalled();
  });

  it("查询与取消转发到内部接口", async () => {
    vi.stubEnv("PATROL_FULL_SCAN_ENABLED", "true");
    const getPatrolScan = vi.fn().mockResolvedValue(jobOf({ status: "running", scanned: 5 }));
    const cancelPatrolScan = vi.fn().mockResolvedValue(jobOf({ status: "cancelled" }));
    const { app } = setup("admin", { getPatrolScan, cancelPatrolScan });

    const detail = await app.request("/agent/patrol/full-scan/9");
    expect(detail.status).toBe(200);
    expect((await detail.json()).data).toMatchObject({ status: "running", scanned: 5 });

    const cancelled = await app.request("/agent/patrol/full-scan/9/cancel", { method: "POST" });
    expect(cancelled.status).toBe(200);
    expect((await cancelled.json()).data.status).toBe("cancelled");
  });

  it("续跑仅接受 queued/running 任务并先认领", async () => {
    vi.stubEnv("PATROL_FULL_SCAN_ENABLED", "true");
    const getPatrolScan = vi.fn().mockResolvedValue(jobOf({ status: "running", scanned: 3 }));
    const claimPatrolScan = vi.fn().mockResolvedValue(claimOf({ scanned: 3 }));
    const { app, startScan } = setup("admin", { getPatrolScan, claimPatrolScan });

    const resumed = await app.request("/agent/patrol/full-scan/9/resume", { method: "POST" });
    expect(resumed.status).toBe(200);
    expect(claimPatrolScan).toHaveBeenCalledWith(
      expect.objectContaining({ jobId: 9, leaseSeconds: 120 }), "trace-full-scan",
    );
    expect(startScan).toHaveBeenCalledWith(
      9, expect.objectContaining({ worker_token: WORKER_TOKEN }),
    );

    getPatrolScan.mockResolvedValue(jobOf({ status: "cancelled" }));
    const rejected = await app.request("/agent/patrol/full-scan/9/resume", { method: "POST" });
    expect(rejected.status).toBe(409);
  });

  it("后端冲突映射为 409", async () => {
    vi.stubEnv("PATROL_FULL_SCAN_ENABLED", "true");
    const createPatrolScan = vi.fn().mockRejectedValue(new InternalApiError(409, 409, "active scan"));
    const { app } = setup("admin", { createPatrolScan });
    const response = await app.request("/agent/patrol/full-scan", {
      method: "POST", headers: { "content-type": "application/json" }, body: "{}",
    });
    expect(response.status).toBe(409);
  });
});
