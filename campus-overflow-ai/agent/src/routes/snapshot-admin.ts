// 管理员查看与回退夜间快照槽：只返回版本与条数，默认关闭，回退不影响在线问答主链路。
import type { Context } from "hono";
import { z } from "zod";

import type { AgentEnvironment } from "../auth/request-context.js";
import { qaSnapshotSlots } from "../knowledge/qa-snapshot.js";
import { getKnowledgeCatalog } from "../knowledge/runtime.js";
import { readSnapshotMetrics, recordSnapshotEvent } from "../knowledge/snapshot-metrics.js";
import type { AgentApp } from "./support.js";

const RollbackSchema = z.object({ target: z.enum(["knowledge", "qa"]) }).strict();

const isEnabled = (): boolean => (process.env.SNAPSHOT_ADMIN_ENABLED ?? "false") === "true";

const snapshotView = () => ({
  knowledge: getKnowledgeCatalog()?.slots() ?? null,
  qa: qaSnapshotSlots.info(),
  metrics: readSnapshotMetrics(),
});

const denied = (c: Context<AgentEnvironment>) => {
  if (!isEnabled()) return c.json({ code: 503, data: null, message: "快照管理接口未启用" }, 503);
  const principal = c.get("principal");
  if (principal.role !== "admin" || principal.status !== "active") {
    return c.json({ code: 403, data: null, message: "仅管理员可管理快照" }, 403);
  }
  return null;
};

export const registerSnapshotAdminRoutes = (app: AgentApp): void => {
  app.get("/agent/admin/snapshots", (c) => {
    c.header("cache-control", "no-store");
    const rejected = denied(c);
    if (rejected) return rejected;
    return c.json({ code: 200, data: snapshotView(), message: "快照槽状态" });
  });

  app.post("/agent/admin/snapshots/rollback", async (c) => {
    c.header("cache-control", "no-store");
    const rejected = denied(c);
    if (rejected) return rejected;
    const target = RollbackSchema.safeParse(await c.req.json().catch(() => null));
    if (!target.success) {
      return c.json({ code: 400, data: null, message: "回退目标必须是 knowledge 或 qa" }, 400);
    }
    try {
      if (target.data.target === "knowledge") {
        const catalog = getKnowledgeCatalog();
        if (!catalog) return c.json({ code: 503, data: null, message: "知识快照未启用" }, 503);
        const info = catalog.rollback();
        recordSnapshotEvent("knowledge", {
          action: "rollback", version: info.active.version, items: info.active.cards,
          errors: 0, ok: true,
        });
      } else {
        const info = qaSnapshotSlots.rollback();
        recordSnapshotEvent("qa", {
          action: "rollback", version: info.active?.version ?? null,
          items: info.active?.items ?? null, errors: 0, ok: true,
        });
      }
    } catch (error) {
      return c.json({
        code: 400, data: null,
        message: error instanceof Error ? error.message : "快照回退失败",
      }, 400);
    }
    return c.json({ code: 200, data: snapshotView(), message: "已回退到旧快照" });
  });
};
