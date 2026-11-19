"use client";

// 审核队列（T-15-D 接真实数据）：状态 Tab + 来源筛选 + 工单表 + 行内处理入口。
// 数据源 GET /api/governance/moderation/cases（仅管理员，后端二次鉴权）；
// [处理] 跳转审批中心并定位工单；本页只读，处置动作在审批中心完成。
import { useState } from "react";
import Link from "next/link";

import { fetchModerationCases } from "@/api/governance";
import {
  EmptyState,
  ErrorState,
  LoadingSkeleton,
  Select,
  TabNav,
} from "@/shared/components";
import { useAsyncData } from "@/shared/hooks/useAsyncData";
import { ApprovalRequestPanel } from "./ApprovalRequestPanel";

const STATUS_TABS = [
  { key: "pending", label: "待处理" },
  { key: "agent_proposed", label: "Agent 已提议" },
  { key: "manager_directed", label: "管理员通道" },
  { key: "executed", label: "已执行" },
  { key: "rejected", label: "已拒绝" },
];

const TARGET_LABELS: Record<string, string> = {
  question: "问题", answer: "回答", comment: "评论", user: "用户",
};

const STATUS_LABELS: Record<string, string> = {
  pending: "待处理", agent_proposed: "Agent 已提议",
  manager_directed: "管理员通道", executed: "已执行", rejected: "已拒绝",
};

const RISK_LABELS: Record<string, string> = {
  low: "低", medium: "中", high: "高",
};

export function ModerationCasesView() {
  const [activeTab, setActiveTab] = useState("pending");
  const [source, setSource] = useState("all");

  const state = useAsyncData(
    () => fetchModerationCases({
      status: activeTab,
      source: source === "all" ? undefined : source,
      page: 1,
      page_size: 50,
    }),
    [activeTab, source],
  );

  const cases = state.data?.items ?? [];
  const total = state.data?.total ?? 0;

  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-[22px] font-semibold text-ink">审核队列</h2>
      <details className="rounded border border-line p-3">
        <summary className="cursor-pointer text-sm text-brand">预览治理动作并提交待审核申请</summary>
        <div className="mt-3"><ApprovalRequestPanel /></div>
      </details>

      <div className="flex flex-wrap items-end gap-3">
        <div className="w-[140px]">
          <Select
            label="来源"
            value={source}
            onChange={(event) => setSource(event.target.value)}
            options={[
              { value: "all", label: "全部来源" },
              { value: "agent", label: "Agent 发起" },
              { value: "admin", label: "管理员创建" },
            ]}
          />
        </div>
      </div>

      <TabNav tabs={STATUS_TABS} active={activeTab} onChange={setActiveTab} />

      {state.isLoading ? <LoadingSkeleton variant="detail" count={3} /> : null}
      {state.error !== null ? (
        <ErrorState message={state.error} onRetry={state.reload} />
      ) : null}

      {!state.isLoading && state.error === null ? (
        <>
          <div className="overflow-x-auto rounded-lg border border-line bg-canvas">
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="border-b border-line text-[12px] text-ink-subtle">
                  <th scope="col" className="py-3 pl-5 pr-4 font-medium">编号</th>
                  <th scope="col" className="py-3 pr-4 font-medium">目标</th>
                  <th scope="col" className="py-3 pr-4 font-medium">风险</th>
                  <th scope="col" className="py-3 pr-4 font-medium">来源</th>
                  <th scope="col" className="py-3 pr-4 font-medium">原因</th>
                  <th scope="col" className="py-3 pr-4 font-medium">状态</th>
                  <th scope="col" className="py-3 pr-4 font-medium">操作</th>
                </tr>
              </thead>
              <tbody>
                {cases.map((item) => (
                  <tr key={item.id} className="border-b border-line-subtle text-[13px]">
                    <td className="py-3 pl-5 pr-4">#{item.id}</td>
                    <td className="py-3 pr-4">
                      {TARGET_LABELS[item.target_type] ?? item.target_type} #{item.target_id}
                    </td>
                    <td className="py-3 pr-4">{RISK_LABELS[item.risk_level] ?? item.risk_level}</td>
                    <td className="py-3 pr-4">{item.source === "agent" ? "Agent" : "管理员"}</td>
                    <td className="max-w-[280px] truncate py-3 pr-4" title={item.reason}>
                      {item.reason}
                    </td>
                    <td className="py-3 pr-4">{STATUS_LABELS[item.status] ?? item.status}</td>
                    <td className="py-3 pr-4">
                      {item.status === "pending" || item.status === "agent_proposed" ? (
                        <Link
                          href={`/admin/moderation/approvals?case_id=${item.id}`}
                          className="co-focusable text-brand hover:underline"
                        >
                          处理
                        </Link>
                      ) : (
                        <span className="text-ink-subtle">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {cases.length === 0 ? (
            <EmptyState
              title="暂无工单"
              description="当前筛选条件下没有审核工单。Agent 静默巡检发现中高风险内容时会自动创建。"
            />
          ) : (
            <p className="text-[12px] text-ink-subtle">共 {total} 条</p>
          )}
        </>
      ) : null}
    </div>
  );
}
