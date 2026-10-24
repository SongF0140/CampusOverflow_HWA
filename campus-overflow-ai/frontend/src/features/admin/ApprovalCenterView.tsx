"use client";

// 审批中心（T-15-D 接真实数据）：左栏工单队列 + 右栏详情与处置面板。
// 数据源 GET /api/governance/moderation/cases；处置 POST resolve（hide/delete/ban/
// ban_temp/warn/skip，C-06 人工确认后由后端执行）；danger 动作 ConfirmDialog 二次确认；
// URL ?case_id= 定位工单（审核队列"处理"入口跳转）。
import { useSearchParams } from "next/navigation";
import { useState } from "react";

import { fetchModerationCases, resolveModerationCase } from "@/api/governance";
import {
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  LoadingSkeleton,
  Select,
  TabNav,
  Toast,
  Textarea,
  type ToastTone,
} from "@/shared/components";
import { toErrorMessage, useAsyncData } from "@/shared/hooks/useAsyncData";
import type { ModerationCaseItem } from "@/shared/types/governance";

const QUEUE_TABS = [
  { key: "pending", label: "待确认" },
  { key: "executed", label: "已处置" },
];

// 处置动作按工单目标类型条件渲染（US-14；C-06：全部人工确认后由后端执行）
const USER_ACTIONS = [
  { value: "warn", label: "警告用户" },
  { value: "ban_temp", label: "限时封禁" },
  { value: "ban", label: "永久封禁" },
  { value: "skip", label: "驳回工单（不处置）" },
];
const CONTENT_ACTIONS = [
  { value: "hide", label: "隐藏内容" },
  { value: "delete", label: "删除内容" },
  { value: "skip", label: "驳回工单（不处置）" },
];
// 需二次确认的高风险动作（C-06）
const DANGEROUS = new Set(["delete", "ban", "ban_temp"]);

const TARGET_LABELS: Record<string, string> = {
  question: "问题", answer: "回答", comment: "评论", user: "用户",
};

export function ApprovalCenterView() {
  const searchParams = useSearchParams();
  const initialCaseId = Number(searchParams.get("case_id") ?? 0) || null;

  const [activeTab, setActiveTab] = useState("pending");
  const [selectedId, setSelectedId] = useState<number | null>(initialCaseId);
  const [feedback, setFeedback] = useState("");
  const [decision, setDecision] = useState("");
  const [durationDays, setDurationDays] = useState("7");
  const [confirming, setConfirming] = useState(false);
  const [toast, setToast] = useState<{ tone: ToastTone; message: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const state = useAsyncData(
    () => fetchModerationCases({ status: activeTab, page: 1, page_size: 50 }),
    [activeTab],
  );
  const cases = state.data?.items ?? [];
  // URL 定位的工单可能不在当前 Tab 列表内：此时提示回队列选择
  const selected: ModerationCaseItem | null =
    cases.find((item) => item.id === selectedId) ?? null;

  async function executeResolve() {
    if (!selected || !decision) return;
    setBusy(true);
    try {
      await resolveModerationCase(selected.id, {
        decision,
        manager_feedback: feedback.trim() || "管理员处置",
        ...(decision === "ban_temp" ? { duration_days: Number(durationDays) } : {}),
      });
      setToast({ tone: "success", message: "已处置并通知当事人" });
      setConfirming(false);
      setDecision("");
      setFeedback("");
      state.reload();
    } catch (caught) {
      setToast({ tone: "error", message: toErrorMessage(caught) });
      setConfirming(false);
    } finally {
      setBusy(false);
    }
  }

  const actionOptions = selected
    ? (selected.target_type === "user" ? USER_ACTIONS : CONTENT_ACTIONS)
    : [];

  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-[22px] font-semibold text-ink">审批中心</h2>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <section aria-label="审批队列" className="flex flex-col gap-3 lg:col-span-5">
          <TabNav tabs={QUEUE_TABS} active={activeTab} onChange={setActiveTab} />
          {state.isLoading ? <LoadingSkeleton variant="detail" count={3} /> : null}
          {state.error !== null ? (
            <ErrorState message={state.error} onRetry={state.reload} />
          ) : null}
          {!state.isLoading && state.error === null ? (
            cases.length === 0 ? (
              <EmptyState
                title="暂无工单"
                description="当前状态下没有待处理的审批工单。Agent 静默巡检发现中高风险内容时会自动创建。"
              />
            ) : (
              <ul className="flex flex-col gap-2">
                {cases.map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(item.id)}
                      className={`w-full rounded-lg border px-4 py-3 text-left text-[13px] transition-colors ${
                        selectedId === item.id
                          ? "border-brand bg-panel"
                          : "border-line bg-canvas hover:bg-panel"
                      }`}
                    >
                      <span className="font-medium">
                        #{item.id} {TARGET_LABELS[item.target_type] ?? item.target_type} #{item.target_id}
                      </span>
                      <span className="mt-1 block truncate text-ink-muted" title={item.reason}>
                        {item.reason}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )
          ) : null}
        </section>

        <section aria-label="工单详情" className="lg:col-span-7">
          <Card className="flex h-full flex-col gap-4 p-5">
            {selected === null ? (
              <EmptyState
                title="选择一个工单"
                description="从左侧队列选择工单查看快照与处置；高风险动作需二次确认。"
              />
            ) : (
              <>
                <div>
                  <h3 className="text-[16px] font-semibold text-ink">
                    工单 #{selected.id}：{TARGET_LABELS[selected.target_type] ?? selected.target_type} #{selected.target_id}
                  </h3>
                  <p className="mt-1 text-[12px] text-ink-subtle">
                    风险 {selected.risk_level} · 来源 {selected.source === "agent" ? "Agent" : "管理员"}
                    {selected.agent_run_id ? ` · 运行 ${selected.agent_run_id.slice(0, 8)}` : ""}
                  </p>
                </div>

                <div className="rounded-md border border-line bg-panel px-4 py-3 text-[13px]">
                  <p className="font-medium text-ink">违规原因</p>
                  <p className="mt-1 text-ink-muted">{selected.reason}</p>
                  {selected.snapshot ? (
                    <p className="mt-2 max-h-24 overflow-y-auto whitespace-pre-wrap text-[12px] text-ink-subtle">
                      快照：{selected.snapshot}
                    </p>
                  ) : null}
                </div>

                {selected.status === "pending" || selected.status === "agent_proposed" ? (
                  <>
                    <Select
                      label="处置动作"
                      value={decision}
                      onChange={(event) => setDecision(event.target.value)}
                      options={[{ value: "", label: "请选择处置动作" }, ...actionOptions]}
                    />
                    {decision === "ban_temp" ? (
                      <Select
                        label="封禁天数（1~30 天，到期自动解禁）"
                        value={durationDays}
                        onChange={(event) => setDurationDays(event.target.value)}
                        options={[3, 7, 14, 30].map((days) => ({
                          value: String(days), label: `${days} 天`,
                        }))}
                      />
                    ) : null}
                    <Textarea
                      label="处置说明"
                      rows={3}
                      value={feedback}
                      onChange={(event) => setFeedback(event.target.value.slice(0, 2000))}
                      placeholder="处置说明将留痕并通知当事人"
                    />
                    <div className="flex gap-2">
                      <Button
                        onClick={() => (DANGEROUS.has(decision) ? setConfirming(true) : void executeResolve())}
                        disabled={!decision || busy}
                      >
                        {busy ? "处置中…" : "执行处置"}
                      </Button>
                    </div>
                  </>
                ) : (
                  <div className="rounded-md border border-line bg-panel px-4 py-3 text-[13px] text-ink-muted">
                    <p>
                      状态：{selected.status === "executed" ? "已执行" : "已拒绝"}
                      {selected.resolution ? ` · 处置：${selected.resolution}` : ""}
                    </p>
                    {selected.manager_feedback ? (
                      <p className="mt-1">处置说明：{selected.manager_feedback}</p>
                    ) : null}
                  </div>
                )}

                {selected.decision_trace ? (
                  <div className="rounded-md border border-dashed border-line bg-panel px-4 py-3">
                    <p className="text-[12px] font-medium text-ink-muted">处置时间线</p>
                    <pre className="mt-1 whitespace-pre-wrap text-[12px] text-ink-subtle">
                      {selected.decision_trace}
                    </pre>
                  </div>
                ) : null}
              </>
            )}
          </Card>
        </section>
      </div>

      {toast !== null && (
        <Toast tone={toast.tone} message={toast.message} onClose={() => setToast(null)} />
      )}
      {confirming && selected !== null ? (
        <ConfirmDialog
          open
          danger
          title={`确认处置工单 #${selected.id}`}
          description={`将以「${decision}」执行处置，结果会通知当事人。${decision === "ban_temp" ? `封禁期限 ${durationDays} 天，到期自动解禁。` : ""}`}
          confirmLabel="确认执行"
          onConfirm={() => void executeResolve()}
          onCancel={() => setConfirming(false)}
        />
      ) : null}
    </div>
  );
}
