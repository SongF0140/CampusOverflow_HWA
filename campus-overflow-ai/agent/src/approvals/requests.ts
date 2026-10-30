import type { AgentPrincipal } from "../auth/principal.js";
import type { UserInternalClient } from "../internal-client.js";
import type { TraceId } from "../types/index.js";
import { ApprovalPolicyError } from "./policy.js";
import { GovernanceRequestInputSchema } from "./types.js";

/** 请求 ID 可重试，实际版本核对、去重和建单由后端同事务执行。 */
export const submitGovernanceRequest = async (
  raw: unknown, principal: AgentPrincipal,
  client: Pick<UserInternalClient, "createGovernanceRequest">, traceId: TraceId,
) => {
  if (principal.role !== "admin" || principal.status !== "active") {
    throw new ApprovalPolicyError(403, "仅管理员可提交治理申请");
  }
  const input = GovernanceRequestInputSchema.parse(raw);
  const result = await client.createGovernanceRequest(input, traceId);
  return {
    ...result, trace_id: traceId, executed: result.status === "executed",
    requires_confirmation: ["pending", "agent_proposed", "manager_directed"].includes(result.status),
  };
};
