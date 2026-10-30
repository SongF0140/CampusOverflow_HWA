import { z } from "zod";
import { buildGovernancePreview } from "../approvals/preview.js";
import { submitGovernanceRequest } from "../approvals/requests.js";
import { ClassChangeInputSchema, GovernancePreviewInputSchema, GovernanceRequestInputSchema } from "../approvals/types.js";
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
    ["request_class_membership", ClassChangeInputSchema, "admin:act"],
    ["read_class_membership_result", z.object({ request_id: z.uuid() }).strict(), "admin:query"],
    ["propose_teaching_experience", z.object({ proposal_id: z.uuid(), course_id: z.number().int().positive(),
      title: z.string().min(1).max(200), summary: z.string().min(1).max(1000),
      steps: z.array(z.string().min(1).max(500)).min(1).max(12) }).strict(), "admin:act"],
  ] as const) {
    registry.registerTool({ name, scope, description: name === "preview_governance"
      ? "查询治理现状及拟动作影响，不执行处置" : name === "request_governance"
        ? "保存待人工确认的治理申请，重复请求不重复建单" : name === "request_class_membership"
          ? "提出任一课程学生名单变更，等待人类管理员确认后执行" : name === "propose_teaching_experience"
            ? "提交课程回答经验建议，待教师或管理员人类审核发布" : "读取申请结果，不执行处置",
    inputSchema: z.toJSONSchema(schema, { io: "input" }), validate: zodValidator(schema),
    execute: async (input, context) => {
      const client = clientForName(context.clientName);
      const trace = asTraceId(context.traceId);
      const principal = await client.resolvePrincipal(trace);
      if (principal.role !== "admin" || principal.status !== "active") throw new Error("管理员身份不可用");
      if (name === "preview_governance") return buildGovernancePreview(input, principal, client, trace);
      if (name === "request_governance") return submitGovernanceRequest(input, principal, client, trace);
      if (name === "request_class_membership") {
        const data = await client.proposeClassChange(ClassChangeInputSchema.parse(input), trace);
        return { ...data, confirmation_url: `/teacher/courses/${data.course_id}/class-changes?request_id=${data.request_id}` };
      }
      if (name === "read_class_membership_result") return client.readClassChange(z.object({ request_id: z.uuid() }).parse(input).request_id, trace);
      if (name === "propose_teaching_experience") return client.submitExperienceProposal(input, trace);
      return client.readApprovalWait(z.object({ request_id: z.uuid() }).parse(input).request_id, "read", trace);
    } });
  }
};
