"use client";
import Link from "next/link";
import { useSyncExternalStore } from "react";
import { useSessionStore } from "@/shared/stores/session-store";
import { useApprovalRequest } from "./useApprovalRequest";
import type { ApprovalDraft } from "./approval-request-client";

const noSubscribe = () => () => undefined;
const stateLabels = { waiting: "等待人工审核", completed: "反馈已恢复", rejected: "已拒绝", cancelled: "已取消等待", expired: "等待已过期" };
const targetLabels = { question: "问题", answer: "回答", comment: "评论", user: "用户" };
const currentLabels: Record<string, string> = { ready: "可治理", active: "账号正常", hidden: "已隐藏", deleted: "已删除", missing: "不存在", banned: "已封禁" };
const actionLabels: Record<string, string> = { hide: "隐藏", delete: "删除", warn: "警告", ban_temp: "限时封禁", ban: "永久封禁" };

export function ApprovalRequestPanel() {
  const me = useSessionStore(state => state.me);
  const hydrated = useSyncExternalStore(noSubscribe, () => true, () => false);
  if (!hydrated || me?.role !== "admin") return null;
  return <ApprovalPanel key={me.id} userId={me.id} />;
}

function ApprovalDraftForm({ draft, change, busy, preview }: {
  draft: ApprovalDraft; change: (draft: ApprovalDraft) => void; busy: boolean; preview: () => void;
}) {
  return <div className="grid gap-3 sm:grid-cols-2">
    <label className="text-sm">目标类型<select aria-label="目标类型" value={draft.target_type} onChange={event => change({ ...draft,
      target_type: event.target.value, action: event.target.value === "user" ? "warn" : "hide", duration_days: undefined })} className="ml-2 rounded border border-line p-2">
      {Object.entries(targetLabels).map(([value, text]) => <option key={value} value={value}>{text}</option>)}
    </select></label>
    <label className="text-sm">目标编号<input aria-label="目标编号" type="number" min={1} value={draft.target_id || ""}
      onChange={event => change({ ...draft, target_id: Number(event.target.value) })} className="ml-2 w-28 rounded border border-line p-2" /></label>
    <label className="text-sm">拟执行动作<select aria-label="拟执行动作" value={draft.action} onChange={event => change({ ...draft,
      action: event.target.value, duration_days: event.target.value === "ban_temp" ? 7 : undefined })} className="ml-2 rounded border border-line p-2">
      {(draft.target_type === "user" ? ["warn", "ban_temp", "ban"] : ["hide", "delete"]).map(value => <option key={value} value={value}>{actionLabels[value]}</option>)}
    </select></label>
    {draft.action === "ban_temp" ? <label className="text-sm">封禁天数<input aria-label="封禁天数" type="number" min={1} max={30} value={draft.duration_days ?? 7}
      onChange={event => change({ ...draft, duration_days: Number(event.target.value) })} className="ml-2 w-24 rounded border border-line p-2" /></label> : null}
    <label className="text-sm sm:col-span-2">治理原因<textarea aria-label="治理原因" maxLength={500} value={draft.reason}
      onChange={event => change({ ...draft, reason: event.target.value })} className="mt-1 block w-full rounded border border-line p-2" /></label>
    <button type="button" onClick={preview} disabled={busy || !Number.isInteger(draft.target_id) || draft.target_id < 1 || !draft.reason.trim()}
      className="rounded border border-line px-3 py-2 text-sm disabled:opacity-50">读取现状并预览</button>
  </div>;
}

function ApprovalPanel({ userId }: { userId: number }) {
  const flow = useApprovalRequest(userId);
  return <section aria-label="治理申请" className="space-y-3 rounded border border-line bg-panel p-4 text-ink">
    <p className="text-sm">先核对后端现状，再提交待审核工单；实际处置需在原审批中心由管理员确认。</p>
    <ApprovalDraftForm draft={flow.draft} change={flow.updateDraft} busy={flow.busy} preview={() => void flow.loadPreview()} />
    {flow.preview ? <div className="space-y-2 rounded border border-line p-3 text-sm">
      <p>后端现状：{currentLabels[flow.preview.current_state] ?? flow.preview.current_state}</p><p>{flow.preview.effect}</p>
      {flow.preview.blocked_reason ? <p>{flow.preview.blocked_reason}</p> : null}
      <button type="button" disabled={flow.busy || !flow.preview.can_request_approval} onClick={() => void flow.submit()}
        className="rounded bg-brand px-3 py-2 text-white disabled:opacity-50">提交待审核</button>
    </div> : null}
    {flow.record ? <div className="space-y-2 text-sm">
      <p>{flow.record.case_id ? `工单 #${flow.record.case_id}；` : "申请已记录；"}默认最多等待 7 天。</p>
      <p className="break-all text-xs text-ink-subtle">申请标识：{flow.record.request_id}</p>
      {flow.record.case_id ? <Link href={`/admin/moderation/approvals?case_id=${flow.record.case_id}`} className="text-brand underline">去审批中心处理工单</Link> : null}
      {flow.wait ? <><p role="status">{stateLabels[flow.wait.state]}</p>
        {flow.wait.executed ? <p>后端已执行该动作，不会再次执行。</p> : null}
        {flow.wait.result ? <p>处置结果：{flow.wait.result.resolution ? actionLabels[flow.wait.result.resolution] ?? flow.wait.result.resolution : "未执行"}</p> : null}
        {flow.wait.expires_at ? <p>等待截止：{new Date(flow.wait.expires_at).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}</p> : null}</> : null}
      <p>取消等待不会撤销工单或已执行的治理；过期仅停止 Agent 续接。</p>
      <div className="flex flex-wrap gap-2">{[[undefined, "核对结果"], ["resume", "恢复反馈"], ["cancel", "取消等待"]].map(([action, text]) =>
        <button key={text} type="button" disabled={flow.busy || (action !== undefined && flow.wait != null && flow.wait.state !== "waiting")} onClick={() => void flow.refresh(action as "resume" | "cancel" | undefined)}
          className="rounded border border-line px-3 py-2 disabled:opacity-50">{text}</button>)}</div>
    </div> : null}
    {flow.error ? <p role="alert" className="text-sm text-red-600">{flow.error}</p> : null}
    {flow.busy ? <p role="status" className="text-sm text-ink-subtle">正在核对…</p> : null}
  </section>;
}
