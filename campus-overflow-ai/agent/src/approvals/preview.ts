import type { AgentPrincipal } from "../auth/principal.js";
import type { UserInternalClient } from "../internal-client.js";
import type { TraceId } from "../types/index.js";
import { ApprovalPolicyError, describeEffect, findApprovalBlock } from "./policy.js";
import { GovernancePreviewInputSchema } from "./types.js";

/** 后端事实与拟动作分开返回；预览不能当成已批准或已执行的凭证。 */
export const buildGovernancePreview = async (
  rawInput: unknown, principal: AgentPrincipal,
  client: Pick<UserInternalClient, "fetchGovernanceTargetState">, traceId: TraceId,
) => {
  if (principal.role !== "admin" || principal.status !== "active") {
    throw new ApprovalPolicyError(403, "仅管理员可预览治理动作");
  }
  const parsed = GovernancePreviewInputSchema.parse(rawInput);
  const input = parsed.action === "ban_temp" ? { ...parsed, duration_days: parsed.duration_days ?? 7 } : parsed;
  const state = await client.fetchGovernanceTargetState({
    targetType: input.target_type, targetId: input.target_id,
  }, traceId);
  const blockedReason = findApprovalBlock(input, state);
  return {
    ...input, current_state: state.current_state, effect: describeEffect(input),
    can_request_approval: blockedReason === undefined,
    ...(blockedReason === undefined ? {} : { blocked_reason: blockedReason }),
    requires_confirmation: true, executed: false, trace_id: traceId,
    notice: "这是当前状态预览，不是执行授权；提交申请与执行时仍须重新核对后端状态和权限",
  };
};
