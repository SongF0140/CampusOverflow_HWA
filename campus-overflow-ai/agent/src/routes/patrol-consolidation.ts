// 手动触发夜间离线整理（N-1）：仅管理员、默认关闭，不提供任何处置能力。
import { z } from "zod";

import { runPatrolConsolidation } from "../scheduler/nightly-consolidation.js";
import { toErrorResponse, type AgentApp } from "./support.js";

const BodySchema = z.object({
  days: z.number().int().min(1).max(90).default(14),
}).strict();

export const registerPatrolConsolidationRoute = (app: AgentApp): void => {
  app.post("/agent/patrol/consolidate", async c => {
    c.header("cache-control", "no-store");
    if ((process.env.PATROL_CONSOLIDATION_ENABLED ?? "false") !== "true") {
      return c.json({ code: 503, data: null, message: "离线整理未启用" }, 503);
    }
    const principal = c.get("principal");
    if (principal.role !== "admin" || principal.status !== "active") {
      return c.json({ code: 403, data: null, message: "仅管理员可触发离线整理" }, 403);
    }
    try {
      const raw: unknown = await c.req.json().catch(() => ({}));
      const parsed = BodySchema.parse(raw ?? {});
      const data = await runPatrolConsolidation({
        client: c.get("internalClient"),
        days: parsed.days,
        traceId: c.get("traceId"),
      });
      return c.json({ code: 200, data, message: "离线整理完成" });
    } catch (error) {
      const mapped = toErrorResponse(error);
      return c.json({ code: mapped.status, data: null, message: mapped.message }, mapped.status);
    }
  });
};
