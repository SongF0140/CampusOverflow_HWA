import { z } from "zod";

import { ApprovalPolicyError } from "../approvals/policy.js";
import { buildGovernancePreview } from "../approvals/preview.js";
import { toErrorResponse, type AgentApp } from "./support.js";

export const registerApprovalRoutes = (app: AgentApp): void => {
  app.post("/agent/approvals/preview", async c => {
    c.header("cache-control", "no-store");
    try {
      const raw: unknown = await c.req.json().catch(() => undefined);
      const data = await buildGovernancePreview(
        raw, c.get("principal"), c.get("internalClient"), c.get("traceId"),
      );
      return c.json({ code: 200, data, message: "治理现状预览，请人工核查后再提交审批" });
    } catch (error) {
      const mapped = error instanceof ApprovalPolicyError
        ? { status: error.status, message: error.message }
        : error instanceof z.ZodError
          ? { status: 400 as const, message: "预览参数不合法，请检查目标、动作、原因和期限" }
          : toErrorResponse(error);
      return c.json({ code: mapped.status, data: null, message: mapped.message,
        trace_id: c.get("traceId") }, mapped.status);
    }
  });
};
