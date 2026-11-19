"use client";
import { useState } from "react";
import { Button, ConfirmDialog } from "@/shared/components";
import type { GovernanceApprovalV2 } from "@/api/governance-v2";
import { useGovernanceApprovalV2 } from "./useGovernanceApprovalV2";

const actions: Record<string, string> = { hide: "隐藏", delete: "删除", warn: "警告", ban: "永久封禁", ban_temp: "限期封禁" };
const targets: Record<string, string> = { question: "问题", answer: "回答", comment: "评论", user: "用户" };
export function approvalStateText(item: GovernanceApprovalV2): string {
  if (item.executed) return "后端已执行，回执已保存";
  if (item.execution_state === "result_unknown" || item.continuation?.outcome === "result_unknown") return "结果待核对，请勿重复处置";
  if (item.status === "approved") return item.execution_state === "claimed" ? "后台已领取，正在核对或执行" : "已批准，等待后台执行";
  const labels: Record<string, string> = { pending: "等待管理员批准", rejected: "已拒绝", cancelled: "已取消", expired: "已过期", invalidated: "目标或批准已失效，请重新预览", blocked: "权限或来源校验未通过，已阻断" };
  return labels[item.status] ?? "请核对状态";
}
export function GovernanceApprovalV2Panel({ requestId }: { requestId: string }) {
  const flow = useGovernanceApprovalV2(requestId);
  const [note, setNote] = useState("");
  const [confirmation, setConfirmation] = useState<{ owner: number; item: GovernanceApprovalV2; operation: "approve" | "reject" | "cancel" } | null>(null);
  const item = flow.item;
  if (flow.owner === undefined) return <p>请使用管理员账号登录后审核。</p>;
  const call = item?.frozen_call;
  const review = confirmation?.item.frozen_call;
  const unknown = item?.execution_state === "result_unknown" || item?.continuation?.outcome === "result_unknown";
  return <section aria-label="版本化治理审批" className="space-y-3 rounded border border-line p-4">
    <h3 className="font-semibold">单次治理调用审核</h3>
    {item && call ? <>
      <p role="status">{approvalStateText(item)}</p>
      <p>目标：{targets[call.target_type] ?? call.target_type} #{call.target_id}；动作：{actions[call.action] ?? call.action}{call.duration_days ? `，${call.duration_days} 天` : ""}</p>
      <p>原因：{call.reason}</p>
      <p className="text-sm">影响：{call.action === "warn" ? "向该用户发送治理警告。" : call.target_type === "user" ? "限制该用户的账号使用。" : "改变该内容的可见性或删除状态。"}本次批准只适用于这一冻结动作。</p>
      <p className="text-sm">批准人：{item.approved_by ? `管理员 #${item.approved_by}` : "尚未批准"}；有效期：{new Date(item.expires_at).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}</p>
      {item.execution_id ? <p className="break-all text-xs">执行标识：{item.execution_id}</p> : null}
      <details className="break-all text-xs"><summary>冻结参数校验信息</summary><p>工具：{call.tool_name}</p><p>参数哈希：{item.args_hash}</p><p>目标版本：{call.expected_version}</p></details>
      {item.status === "pending" ? <>
        <label className="block text-sm">审核说明<textarea aria-label="审核说明" maxLength={500} value={note} onChange={e => setNote(e.target.value)} className="mt-1 block w-full rounded border border-line p-2" /></label>
        <Button disabled={flow.busy} onClick={() => setConfirmation({ owner: flow.owner!, item, operation: "approve" })}>批准此动作</Button>
        <Button disabled={flow.busy} onClick={() => setConfirmation({ owner: flow.owner!, item, operation: "reject" })}>拒绝此动作</Button>
      </> : null}
      {(item.status === "pending" || item.status === "approved") && !unknown ? <Button disabled={flow.busy} onClick={() => setConfirmation({ owner: flow.owner!, item, operation: "cancel" })}>取消待执行动作</Button> : null}
      <p className="text-xs text-ink-subtle">批准成功只代表后台获得本次授权；是否完成以后端执行状态为准。已进入执行事务的动作可能无法取消。</p>
    </> : <p>正在读取后端冻结清单…</p>}
    <Button disabled={flow.busy} onClick={() => void flow.refresh()}>核对执行状态</Button>
    {flow.error ? <p role="alert">{flow.error}</p> : null}
    {confirmation && review && confirmation.owner === flow.owner && confirmation.item.request_id === requestId ? <ConfirmDialog open danger title={confirmation.operation === "approve" ? "批准冻结治理动作" : confirmation.operation === "reject" ? "拒绝治理动作" : "取消待执行动作"}
      description={`${targets[review.target_type] ?? review.target_type} #${review.target_id}：${actions[review.action] ?? review.action}${review.duration_days ? ` ${review.duration_days} 天` : ""}。${confirmation.operation === "approve" ? "确认后仅放行这一次调用，后台复核后执行。" : "该操作不撤销已经执行的治理。"}`}
      confirmLabel={confirmation.operation === "approve" ? "确认批准" : "确认"} onCancel={() => setConfirmation(null)}
      onConfirm={() => { const selected = confirmation; setConfirmation(null); void flow.decide(selected.item, selected.operation, note.trim() || "管理员已核对冻结清单"); }} /> : null}
  </section>;
}
