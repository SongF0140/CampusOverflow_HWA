// 治理（审批中心与申诉）API（T-15-D，US-13/14/16）：admin 三页与申诉数据源。
// 全部走同源 BFF（/api/backend/api/**），蛇形字段与后端 governance 契约一致。
import { apiFetch, apiFetchWithMessage } from "./client";
import type {
  AppealItem,
  AppealList,
  ModerationCaseItem,
  ModerationCaseList,
} from "@/shared/types/governance";

export type {
  AppealItem,
  AppealList,
  ModerationCaseItem,
  ModerationCaseList,
} from "@/shared/types/governance";

export function fetchModerationCases(
  params: { page?: number; page_size?: number; status?: string; source?: string } = {},
) {
  const query = new URLSearchParams();
  if (params.page !== undefined) query.set("page", String(params.page));
  if (params.page_size !== undefined) query.set("page_size", String(params.page_size));
  if (params.status) query.set("status", params.status);
  if (params.source) query.set("source", params.source);
  const suffix = query.toString() ? `?${query.toString()}` : "";
  return apiFetch<ModerationCaseList>(`/governance/moderation/cases${suffix}`);
}

/** 管理员处置工单：hide/delete/ban/ban_temp/warn/skip；ban_temp 可带期限 */
export function resolveModerationCase(
  caseId: number,
  input: { decision: string; manager_feedback: string; duration_days?: number },
) {
  return apiFetchWithMessage<ModerationCaseItem>(
    `/governance/moderation/cases/${caseId}/resolve`,
    { method: "POST", body: JSON.stringify(input) },
  );
}

export function fetchAppeals(
  params: { page?: number; page_size?: number; status?: string } = {},
) {
  const query = new URLSearchParams();
  if (params.page !== undefined) query.set("page", String(params.page));
  if (params.page_size !== undefined) query.set("page_size", String(params.page_size));
  if (params.status) query.set("status", params.status);
  const suffix = query.toString() ? `?${query.toString()}` : "";
  return apiFetch<AppealList>(`/governance/appeals${suffix}`);
}

/** 管理员复核申诉：accepted 撤销处置 / rejected 维持 */
export function resolveAppeal(
  appealId: number,
  input: { resolution: string; resolution_note: string },
) {
  return apiFetchWithMessage<AppealItem>(`/governance/appeals/${appealId}/resolve`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}
