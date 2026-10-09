"use client";

import { useState } from "react";

import { Card, EmptyState, Select, TabNav } from "@/shared/components";

const QUEUE_TABS = [
  { key: "pending", label: "待处理" },
  { key: "resolved", label: "已处理" },
];

// 工单处理（页面控件级设计说明 §3.4）：双栏骨架——左栏工单队列（5 列）+ 右栏详情占位（7 列）
// TODO(接口差异)：governance 工单接口为 501 占位（治理逻辑一期仅建表），队列与详情均为静态骨架，
// 不调用接口、不放假数据；工单行、处置动作按钮组、来源内容预览与处理记录时间线随接口开放后补齐
export function TeacherModerationView({ initialCaseId }: { initialCaseId?: string | null }) {
  // Tab 为组件状态：工单接口开放后按仓库约定改为 URL 参数来源
  const [activeTab, setActiveTab] = useState("pending");

  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-[22px] font-semibold text-ink">工单处理</h2>

      {/* initialCaseId（case_id）自动选中随工单接口开放：当前无工单数据可选中，仅预留挂载点 */}
      <div
        className="grid grid-cols-1 gap-4 lg:grid-cols-12"
        data-case-id={initialCaseId ?? undefined}
      >
        <section aria-label="工单队列" className="flex flex-col gap-3 lg:col-span-5">
          <TabNav tabs={QUEUE_TABS} active={activeTab} onChange={setActiveTab} />
          {/* TODO(接口差异)：课程筛选选项随工单接口开放后接入，当前空选项占位 */}
          <Select
            label="课程"
            options={[{ value: "", label: "全部课程" }]}
            disabled
            className="max-w-xs"
          />
          <EmptyState
            title="工单接口随二期开放"
            description="内容审核工单由治理模块提供，接口开放后此处展示工单队列与状态筛选。"
          />
        </section>

        <section aria-label="工单详情" className="lg:col-span-7">
          <Card className="flex h-full flex-col gap-2 p-5">
            <h3 className="text-[16px] font-semibold text-ink">工单详情</h3>
            <p className="text-[13px] leading-relaxed text-ink-muted">
              处置动作与来源内容预览随工单接口开放。
            </p>
          </Card>
        </section>
      </div>
    </div>
  );
}
