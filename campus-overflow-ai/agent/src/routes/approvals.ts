import { z } from "zod";

import type { AgentPrincipal } from "../auth/principal.js";
import { ApprovalPolicyError } from "../approvals/policy.js";
import { buildGovernancePreview } from "../approvals/preview.js";
import { submitGovernanceRequest } from "../approvals/requests.js";
import { InternalApiError, type UserInternalClient } from "../internal-client.js";
import type { TraceId } from "../types/index.js";
import { toErrorResponse, type AgentApp } from "./support.js";

export const registerApprovalRoutes = (app: AgentApp): void => {
  registerRoute(app, "/agent/approvals/preview", buildGovernancePreview,
    "治理现状预览，请人工核查后再提交审批");
  registerRoute(app, "/agent/approvals/requests", submitGovernanceRequest,
    "审批申请已保存，当前状态以返回结果为准");
};

const registerRoute = <T>(
  app: AgentApp, path: string,
  handler: (raw: unknown, principal: AgentPrincipal, client: UserInternalClient, trace: TraceId) => Promise<T>,
  message: string,
) => {
  app.post(path, async c => {
    c.header("cache-control", "no-store");
    try {
      const raw: unknown = await c.req.json().catch(() => undefined);
      const data = await handler(
        raw, c.get("principal"), c.get("internalClient"), c.get("traceId"),
      );
      return c.json({ code: 200, data, message });
    } catch (error) {
      const mapped = error instanceof ApprovalPolicyError
        ? { status: error.status, message: error.message }
        : error instanceof InternalApiError && error.status === 409
          ? { status: 409 as const, message: "申请参数或目标状态已变化，请重新预览并申请" }
          : error instanceof z.ZodError
          ? { status: 400 as const, message: "预览参数不合法，请检查目标、动作、原因和期限" }
          : toErrorResponse(error);
      return c.json({ code: mapped.status, data: null, message: mapped.message,
        trace_id: c.get("traceId") }, mapped.status);
    }
  });
};
