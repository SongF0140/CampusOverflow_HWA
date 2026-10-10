"use client";

import { useState } from "react";

import { Card, EmptyState, TabNav, Textarea } from "@/shared/components";

const QUEUE_TABS = [
  { key: "all", label: "全部" },
  { key: "pending", label: "待确认" },
  { key: "resolved", label: "已处置" },
];

// 审批中心（页面控件级设计说明 §4.5）：双栏骨架——左栏审批队列（5 列）+ 右栏工单详情占位（7 列）
// TODO(接口差异)：审批接口一期为 501 占位（治理逻辑仅建表），本页为静态骨架，不调用接口、不放假数据。
// 关键约束（tasks.md）：接口 501 期间不渲染七动作按钮组；待 POST /api/admin/approvals/{id}/resolve
// 开放后按工单类型条件渲染：隐藏内容 / 恢复内容 / 警告用户 / 封禁用户 / 驳回工单 / 标记误报 /
// 转人工复核（danger 动作提交前 ConfirmDialog 二次确认，成功 Toast“已处置并通知当事人”）。
export function ApprovalCenterView() {
  // 队列 Tab 为组件状态：审批接口开放后按仓库约定改为 URL 参数来源
  const [activeTab, setActiveTab] = useState("all");

  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-[22px] font-semibold text-ink">审批中心</h2>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <section aria-label="审批队列" className="flex flex-col gap-3 lg:col-span-5">
          <TabNav tabs={QUEUE_TABS} active={activeTab} onChange={setActiveTab} />
          <EmptyState
            title="审批接口随二期开放"
            description="AI 相关高风险动作的审批工单由治理模块提供，接口开放后此处展示审批队列。"
          />
        </section>

        <section aria-label="工单详情" className="lg:col-span-7">
          <Card className="flex h-full flex-col gap-4 p-5">
            <h3 className="text-[16px] font-semibold text-ink">工单详情</h3>

            {/* 发起方块占位：人工 / [AI 发起] 徽标位；AI 发起时以纯文本展示 run_id/trace_id（运行详情页暂缓） */}
            <div className="rounded-md border border-dashed border-line bg-panel px-4 py-3 text-[13px] text-ink-muted">
              发起方占位：人工 / [AI 发起] 徽标位；AI 发起时展示 run_id / trace_id 纯文本。
            </div>

            {/* 关联内容预览卡占位：[查看来源] → /questions/{内容 id}（问题详情），随接口开放渲染 */}
            <div className="rounded-md border border-dashed border-line bg-panel px-4 py-3 text-[13px] text-ink-muted">
              关联内容预览占位：展示被举报内容摘要，并提供 [查看来源] 跳转问题详情。
            </div>

            <Textarea label="处置说明" rows={4} disabled hint="接口开放后可编辑" />

            {/* 处置时间线占位（留痕）：处置记录随接口开放后展示 */}
            <p className="text-[13px] text-ink-muted">
              处置时间线占位：每次处置将在此留痕（操作者、意见与时间）。
            </p>
          </Card>
        </section>
      </div>
    </div>
  );
}
