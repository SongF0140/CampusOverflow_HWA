"use client";

import { useState } from "react";

import { EmptyState, Select, TabNav } from "@/shared/components";

const STATUS_TABS = [
  { key: "pending", label: "待处理" },
  { key: "resolved", label: "已处理" },
];

// 审核队列（页面控件级设计说明 §4.4）：状态 Tab + 类型/来源筛选 + 工单表骨架
// TODO(接口差异)：governance 工单接口一期为 501 占位（治理逻辑仅建表），本页为静态骨架，
// 不调用接口、不放假数据；工单行随接口开放后渲染。
// 操作约定：行内 [处理] → /admin/moderation/approvals?case_id={编号}，随接口开放渲染。
export function ModerationCasesView() {
  // 状态 Tab 为组件状态：工单接口开放后按仓库约定改为 URL 参数来源
  const [activeTab, setActiveTab] = useState("pending");

  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-[22px] font-semibold text-ink">审核队列</h2>

      <div className="flex flex-wrap items-end gap-3">
        {/* TODO(接口差异)：类型/来源为服务端筛选占位（选项按 §4.4 固定），接口开放后接入并启用 */}
        <div className="w-[140px]">
          <Select
            label="类型"
            options={[
              { value: "all", label: "全部类型" },
              { value: "content_report", label: "内容举报" },
              { value: "other", label: "其他" },
            ]}
            disabled
          />
        </div>
        <div className="w-[140px]">
          <Select
            label="来源"
            options={[
              { value: "all", label: "全部来源" },
              { value: "manual", label: "人工举报" },
              { value: "agent", label: "Agent 发起" },
            ]}
            disabled
          />
        </div>
      </div>

      <TabNav tabs={STATUS_TABS} active={activeTab} onChange={setActiveTab} />

      {/* 工单表骨架：仅表头占位，数据行随 governance 工单接口开放后渲染 */}
      <div className="overflow-x-auto rounded-lg border border-line bg-canvas">
        <table className="w-full border-collapse text-left">
          <thead>
            <tr className="border-b border-line text-[12px] text-ink-subtle">
              <th scope="col" className="py-3 pl-5 pr-4 font-medium">编号</th>
              <th scope="col" className="py-3 pr-4 font-medium">类型</th>
              <th scope="col" className="py-3 pr-4 font-medium">课程</th>
              <th scope="col" className="py-3 pr-4 font-medium">提交方</th>
              <th scope="col" className="py-3 pr-4 font-medium">状态</th>
              <th scope="col" className="py-3 pr-4 font-medium">时间</th>
              <th scope="col" className="py-3 pr-4 font-medium">操作</th>
            </tr>
          </thead>
          <tbody />
        </table>
      </div>

      {/* governance 501：无数据可分页，分页组件不渲染 */}
      <EmptyState
        title="工单接口随二期开放"
        description="内容审核工单由治理模块提供，接口开放后此处展示工单列表与处理入口。"
      />
    </div>
  );
}
