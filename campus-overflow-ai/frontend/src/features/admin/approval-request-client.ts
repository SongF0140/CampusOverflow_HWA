export interface ApprovalDraft {
  target_type: string; target_id: number; action: string; reason: string; duration_days?: number;
}
export interface ApprovalPreview {
  current_state: string; state_version: string; effect: string; can_request_approval: boolean; blocked_reason?: string;
}
export interface ApprovalRecord { request_id: string; case_id?: number }
export interface ApprovalWait {
  request_id: string; case_id: number;
  state: "waiting" | "completed" | "rejected" | "expired" | "cancelled";
  case_status: string; expires_at: string | null; executed: boolean;
  result: { case_status: string; resolution: string | null; executed: boolean } | null;
}

export async function approvalRequest<T>(path: string, signal: AbortSignal, body?: unknown): Promise<T> {
  const response = await fetch(`/api/agent/agent/approvals/${path}`, {
    method: body === undefined ? "GET" : "POST", signal, cache: "no-store",
    ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
  });
  const envelope = await response.json().catch(() => null) as { code?: number; data?: T; message?: string } | null;
  if (!response.ok || envelope?.code !== 200 || envelope.data == null) {
    throw new Error(envelope?.message ?? "审批服务暂不可用，请稍后重试");
  }
  return envelope.data;
}
const recordKey = (userId: number) => `co_approval_user_${userId}`;
export const readApprovalRecord = (userId: number): ApprovalRecord | null => {
  try {
    const item: unknown = JSON.parse(localStorage.getItem(recordKey(userId)) ?? "null");
    if (!item || typeof item !== "object" || !("request_id" in item) || typeof item.request_id !== "string"
      || !/^[0-9a-f-]{36}$/i.test(item.request_id)) return null;
    return item as ApprovalRecord;
  } catch { return null; }
};
export const saveApprovalRecord = (userId: number, record: ApprovalRecord): void => {
  try { localStorage.setItem(recordKey(userId), JSON.stringify(record)); }
  catch { throw new Error("浏览器无法保存申请标识，请释放存储空间后重试"); }
};
