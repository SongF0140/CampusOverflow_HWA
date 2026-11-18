// S4 快照管理：默认关闭、仅管理员、槽信息与指标只读、显式回退。
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AgentEnvironment } from "../src/auth/request-context.js";
import type { QaIndexItem, UserInternalClient } from "../src/internal-client.js";
import { qaSnapshotSlots, type QaSnapshot } from "../src/knowledge/qa-snapshot.js";
import { readSnapshotMetrics, resetSnapshotMetrics } from "../src/knowledge/snapshot-metrics.js";
import { registerSnapshotAdminRoutes } from "../src/routes/snapshot-admin.js";

const item = (id: number): QaIndexItem => ({
  id, title: `问题${id}`, course_id: 1, status: "published",
  tag_ids: [], updated_at: "2026-11-01T00:00:00",
});

const snapshot = (version: string, count: number): QaSnapshot => {
  const items = Array.from({ length: count }, (_, index) => item(index + 1));
  return { version, items, byId: new Map(items.map(entry => [entry.id, entry])) };
};

const clientOf = () => ({}) as unknown as UserInternalClient;

const setupApp = (role: "student" | "admin") => {
  const app = new Hono<AgentEnvironment>();
  app.use("*", async (c, next) => {
    c.set("principal", {
      user_id: 7, role, status: "active", identity_type: "graduate",
      assistant_cert_status: "approved",
    });
    c.set("internalClient", clientOf());
    c.set("traceId", "trace-snapshot-admin" as never);
    await next();
  });
  registerSnapshotAdminRoutes(app);
  return app;
};

beforeEach(() => {
  resetSnapshotMetrics();
  vi.stubEnv("SNAPSHOT_ADMIN_ENABLED", "true");
  vi.stubEnv("KNOWLEDGE_ROOT", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
  resetSnapshotMetrics();
});

describe("快照管理路由", () => {
  it("默认关闭返回 503", async () => {
    vi.stubEnv("SNAPSHOT_ADMIN_ENABLED", "false");
    const response = await setupApp("admin").request("/agent/admin/snapshots");
    expect(response.status).toBe(503);
  });

  it("仅管理员可访问", async () => {
    const response = await setupApp("student").request("/agent/admin/snapshots");
    expect(response.status).toBe(403);
  });

  it("管理员读取槽信息与最近指标", async () => {
    qaSnapshotSlots.stage(snapshot("qa-v1", 2));
    qaSnapshotSlots.promote();
    const response = await setupApp("admin").request("/agent/admin/snapshots");
    expect(response.status).toBe(200);
    const data = (await response.json()).data;
    expect(data.knowledge).toBeNull();
    expect(data.qa.active).toEqual({ version: "qa-v1", items: 2 });
    expect(data.qa.staging).toBeNull();
    expect(data.metrics).toEqual({ knowledge: null, qa: null });
  });

  it("回退到上一版并写入回退指标", async () => {
    qaSnapshotSlots.stage(snapshot("qa-v1", 1));
    qaSnapshotSlots.promote();
    qaSnapshotSlots.stage(snapshot("qa-v2", 3));
    qaSnapshotSlots.promote();

    const response = await setupApp("admin").request("/agent/admin/snapshots/rollback", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ target: "qa" }),
    });
    expect(response.status).toBe(200);
    const data = (await response.json()).data;
    expect(data.qa.active).toEqual({ version: "qa-v1", items: 1 });
    expect(data.qa.previous).toBeNull();
    expect(readSnapshotMetrics().qa).toMatchObject({
      action: "rollback", version: "qa-v1", items: 1, ok: true,
    });
  });

  it("没有旧槽时回退返回 400", async () => {
    qaSnapshotSlots.stage(snapshot("qa-a", 1));
    qaSnapshotSlots.promote();
    qaSnapshotSlots.stage(snapshot("qa-b", 1));
    qaSnapshotSlots.promote();
    const rollback = () => setupApp("admin").request("/agent/admin/snapshots/rollback", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ target: "qa" }),
    });
    expect((await rollback()).status).toBe(200);
    expect((await rollback()).status).toBe(400);
  });

  it("非法回退目标返回 400", async () => {
    const response = await setupApp("admin").request("/agent/admin/snapshots/rollback", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ target: "memory" }),
    });
    expect(response.status).toBe(400);
  });

  it("知识快照未配置时回退返回 503", async () => {
    const response = await setupApp("admin").request("/agent/admin/snapshots/rollback", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ target: "knowledge" }),
    });
    expect(response.status).toBe(503);
  });
});
