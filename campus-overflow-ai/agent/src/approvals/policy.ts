import type { GovernancePreviewInput, GovernanceState } from "./types.js";

export class ApprovalPolicyError extends Error {
  constructor(readonly status: 403, message: string) {
    super(message);
    this.name = "ApprovalPolicyError";
  }
}

/** 只判断现状是否适合提出申请，完整动作权限仍由后端在提交和执行时复核。 */
export const findApprovalBlock = (
  input: GovernancePreviewInput, state: GovernanceState,
): string | undefined => {
  if (state.current_state === "missing") return "目标不存在，不能提交该治理建议";
  if (state.current_state === "deleted") return "目标已删除，无需重复处置";
  if (state.current_state === "banned") return "目标用户当前已封禁，请重新核查处置意图";
  if (state.current_state === "hidden" && input.action !== "delete") {
    return "目标已隐藏，无需重复隐藏；如需升级删除应重新选择动作";
  }
  return undefined;
};

export const describeEffect = (input: GovernancePreviewInput): string => {
  const effects = {
    hide: "拟隐藏该内容，使其不再出现在普通用户的公开读取结果中",
    delete: "拟软删除该内容，保留治理审计记录",
    ban: "拟永久封禁目标账号，最终受后端身份保护规则约束",
    ban_temp: `拟限时封禁目标账号 ${input.duration_days ?? 7} 天，最终受后端身份保护规则约束`,
    warn: "拟向目标用户发送警告并记录审计，不更改账号状态或内容",
  };
  return effects[input.action];
};
