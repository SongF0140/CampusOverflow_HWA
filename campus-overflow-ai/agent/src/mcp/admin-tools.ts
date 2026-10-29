import { z } from "zod";
import { buildGovernancePreview } from "../approvals/preview.js";
import { submitGovernanceRequest } from "../approvals/requests.js";
import { GovernancePreviewInputSchema, GovernanceRequestInputSchema } from "../approvals/types.js";
import type { UserInternalClient } from "../internal-client.js";
import { asTraceId } from "../types/index.js";
import { type McpToolRegistry, zodValidator } from "./registry.js";

/** 工具面不提供人工确认；每次调用重新解析后端有效管理员。 */
export const ensureAdminMcpTools = (
  registry: McpToolRegistry, clientForName: (name: string) => UserInternalClient,
) => {
  for (const [name, schema, scope] of [
    ["preview_governance", GovernancePreviewInputSchema, "admin:query"],
    ["request_governance", GovernanceRequestInputSchema, "admin:act"],
    ["read_governance_result", z.object({ request_id: z.uuid() }).strict(), "admin:query"],
  ] as const) {
    registry.registerTool({ name, scope, description: name === "preview_governance"
      ? "查询治理现状及拟动作影响，不执行处置" : name === "request_governance"
        ? "保存待人工确认的治理申请，重复请求不重复建单" : "读取申请结果，不执行治理",
    inputSchema: z.toJSONSchema(schema, { io: "input" }), validate: zodValidator(schema),
    execute: async (input, context) => {
      const client = clientForName(context.clientName);
      const trace = asTraceId(context.traceId);
      const principal = await client.resolvePrincipal(trace);
      if (principal.role !== "admin" || principal.status !== "active") throw new Error("管理员身份不可用");
      if (name === "preview_governance") return buildGovernancePreview(input, principal, client, trace);
      if (name === "request_governance") return submitGovernanceRequest(input, principal, client, trace);
      return client.readApprovalWait(z.object({ request_id: z.uuid() }).parse(input).request_id, "read", trace);
    } });
  }
};
