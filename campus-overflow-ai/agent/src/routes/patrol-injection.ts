// 管理员预览 N-3 注入上下文：只读、默认关闭，不改变巡检判定。
import { z } from "zod";

import { buildInjectedContext } from "../scheduler/patrol-injection.js";
import { toErrorResponse, type AgentApp } from "./support.js";

const QuerySchema = z.object({
  max_chars: z.coerce.number().int().min(200).max(4000).default(2000),
  min_confidence: z.coerce.number().int().min(0).max(100).default(80),
  limit: z.coerce.number().int().min(1).max(50).default(20),
}).strict();

export const registerPatrolInjectionRoute = (app: AgentApp): void => {
  app.get("/agent/patrol/injected-context", async c => {
    c.header("cache-control", "no-store");
    if ((process.env.PATROL_INJECTION_ENABLED ?? "false") !== "true") {
      return c.json({ code: 503, data: null, message: "巡检注入预览未启用" }, 503);
    }
    const principal = c.get("principal");
    if (principal.role !== "admin" || principal.status !== "active") {
      return c.json({ code: 403, data: null, message: "仅管理员可查看注入上下文" }, 403);
    }
    try {
      const query = QuerySchema.parse(c.req.query());
      const rendered = await buildInjectedContext({
        client: c.get("internalClient"),
        maxChars: query.max_chars,
        minConfidence: query.min_confidence,
        limit: query.limit,
        traceId: c.get("traceId"),
      });
      return c.json({
        code: 200,
        data: { ...rendered, max_chars: query.max_chars },
        message: "注入上下文预览",
      });
    } catch (error) {
      const mapped = toErrorResponse(error);
      return c.json({ code: mapped.status, data: null, message: mapped.message }, mapped.status);
    }
  });
};
