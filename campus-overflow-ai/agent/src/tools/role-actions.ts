import { createHash } from "node:crypto";
import { z } from "zod";
import type { AgentPrincipal } from "../auth/principal.js";
import { buildGovernancePreview } from "../approvals/preview.js";
import { GovernancePreviewInputSchema } from "../approvals/types.js";
import { InternalApiError, type UserInternalClient } from "../internal-client.js";
import type { AgentTool, ToolExecutionContext } from "./registry.js";

const requestId = (context: ToolExecutionContext, input: unknown): string => {
  const hex = createHash("sha256").update(JSON.stringify([context.agentRunId, input])).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
};

/** low 指提议/读结果本身；真实高风险处置不在此工具执行，确认入口不提供给模型。 */
export const createRoleActionTools = (client: UserInternalClient, principal: AgentPrincipal): AgentTool[] => {
  const verify = async (context: ToolExecutionContext, role: "teacher" | "admin") => {
    const current = await client.resolvePrincipal(context.traceId);
    const allowed = current.role === role || (current.role === "admin" && role === "teacher");
    if (current.user_id !== principal.user_id || current.role !== principal.role || !allowed || current.status !== "active") {
      throw new InternalApiError(403, 403, "当前角色无此工具权限");
    }
    return current;
  };
  const tools: AgentTool[] = [];
  if (principal.role === "admin") tools.push(...[
    { name: "proposeGovernance", description: "查询真实现状并提出隐藏/删除/警告/封禁申请；必须由管理员在审批中心人工确认后后端才执行",
      riskLevel: "low", inputSchema: GovernancePreviewInputSchema, execute: async (raw, context) => {
        const current = await verify(context, "admin");
        const input = GovernancePreviewInputSchema.parse(raw);
        const preview = await buildGovernancePreview(input, current, client, context.traceId);
        if (!preview.can_request_approval || !preview.state_version) return preview;
        const result = await client.createGovernanceRequest({ ...input, request_id: requestId(context, input),
          expected_version: preview.state_version }, context.traceId);
        return { ...preview, ...result, requires_confirmation: result.status !== "executed" && result.status !== "rejected",
          approval_required: result.status === "pending", confirmation_url: `/admin/moderation/approvals?case_id=${result.case_id}` };
      } },
    { name: "readGovernanceResult", description: "批准并由后端执行后读取治理反馈，不重复执行治理", riskLevel: "low",
      inputSchema: z.object({ request_id: z.uuid() }).strict(), execute: async (input, context) => {
        await verify(context, "admin");
        return client.readApprovalWait(z.object({ request_id: z.uuid() }).parse(input).request_id, "read", context.traceId);
      } },
  ] as AgentTool[]);
  if (principal.role === "teacher" || principal.role === "admin") tools.push(...[
    { name: "proposeClassMembership", description: principal.role === "admin"
      ? "提出任一课程学生加入/移出清单，由管理员本人在人类界面确认后执行；工具不直接修改名单"
      : "将学生加入或移出本人负责班级的变更申请；先展示清单，由负责教师人工确认，工具不直接修改名单",
      riskLevel: "low", inputSchema: z.object({ course_id: z.number().int().positive(),
        student_ids: z.array(z.number().int().positive()).min(1).max(50), action: z.enum(["add", "remove"]) }).strict(),
      execute: async (raw, context) => {
        await verify(context, "teacher");
        const input = z.object({ course_id: z.number(), student_ids: z.array(z.number()), action: z.enum(["add", "remove"]) }).parse(raw);
        input.student_ids.sort((a, b) => a - b);
        const result = await client.proposeClassChange({ ...input, request_id: requestId(context, input) }, context.traceId);
        return { ...result, approval_required: result.status === "pending",
          confirmation_url: `/teacher/courses/${result.course_id}/class-changes?request_id=${result.request_id}` };
      } },
    { name: "readClassMembershipResult", description: "读取本人名单申请的状态，不修改或确认名单", riskLevel: "low",
      inputSchema: z.object({ request_id: z.uuid() }).strict(), execute: async (input, context) => {
        await verify(context, "teacher");
        return client.readClassChange(z.object({ request_id: z.uuid() }).parse(input).request_id, context.traceId);
      } },
    { name: "proposeTeachingExperience", description: "提交通用回答流程经验建议，不能带私人聊天/记忆或权限规则；由负责教师或管理员人工审核发布，不自动生效",
      riskLevel: "low", inputSchema: z.object({ course_id: z.number().int().positive(), title: z.string().min(1).max(200),
        summary: z.string().min(1).max(1000), steps: z.array(z.string().min(1).max(500)).min(1).max(12) }).strict(),
      execute: async (input, context) => {
        await verify(context, "teacher");
        const body = z.object({ course_id: z.number(), title: z.string(), summary: z.string(), steps: z.array(z.string()) }).parse(input);
        const result = await client.submitExperienceProposal({ ...body, proposal_id: requestId(context, body) }, context.traceId);
        return { ...result, course_id: body.course_id, approval_required: result.status === "pending",
          confirmation_url: `/teacher/courses/${body.course_id}/experiences` };
      } },
  ] as AgentTool[]);
  return tools;
};
