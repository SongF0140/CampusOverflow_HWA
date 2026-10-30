import { apiFetch } from "./client";
export interface GovernanceApprovalV2 {
  contract_version: 2; request_id: string; case_id: number; requester_id: number;
  source_kind: "admin" | "platform"; args_hash: string;
  status: "pending" | "approved" | "executed" | "rejected" | "cancelled" | "expired" | "invalidated" | "blocked";
  executed: boolean; approved_by: number | null; approved_at: string | null; expires_at: string;
  execution_id: string | null; execution_state: string | null;
  continuation: { stage?: string; outcome?: string } | null;
  frozen_call: { target_type: string; target_id: number; action: string; reason: string; duration_days: number | null; expected_version: string; tool_name: string };
}
const base = "/governance/approval-requests";
const validate = (item: GovernanceApprovalV2, id: string) => {
  if (item.contract_version !== 2 || item.request_id !== id || item.executed !== (item.status === "executed")) {
    throw new Error("审批响应不一致，请重新核对");
  }
  return item;
};
export const readGovernanceApproval = async (id: string, signal?: AbortSignal) =>
  validate(await apiFetch<GovernanceApprovalV2>(`${base}/${encodeURIComponent(id)}`, { signal }), id);
export const decideGovernanceApproval = async (item: GovernanceApprovalV2, operation: "approve" | "reject" | "cancel", note: string, signal?: AbortSignal) =>
  validate(await apiFetch<GovernanceApprovalV2>(`${base}/${encodeURIComponent(item.request_id)}/${operation}`, {
    method: "POST", signal, body: JSON.stringify({ args_hash: item.args_hash, note }),
  }), item.request_id);

/** undefined为旧契约；空字符串为损坏v2，必须显示错误而不能回退旧resolve。 */
export const v2RequestId = (snapshot: string | null): string | undefined => {
  try {
    const parsed = JSON.parse(snapshot ?? "null");
    if (parsed?.contract !== "approval-v2") return undefined;
    return typeof parsed.request_id === "string" && /^[0-9a-f-]{36}$/i.test(parsed.request_id) ? parsed.request_id : "";
  } catch { return snapshot?.includes("approval-v2") ? "" : undefined; }
};
