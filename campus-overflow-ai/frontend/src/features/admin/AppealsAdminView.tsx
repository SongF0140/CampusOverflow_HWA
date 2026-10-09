"use client";

import { EmptyState, Select } from "@/shared/components";

// 申诉处理（页面控件级设计说明 §4.6）：状态筛选 + 申诉表骨架
// TODO(接口差异)：申诉接口一期为 501 占位（T-15 随二期），本页为静态骨架，不调用接口、不放假数据。
// 操作约定：行内 [维持(ghost)] / [撤销(danger)] 随接口开放渲染；撤销需 ConfirmDialog 二次确认，
// 并联动提示“撤销封禁将同时解禁该用户”，确认后用户管理页可见状态变更；操作写入时间线留痕。
export function AppealsAdminView() {
  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-[22px] font-semibold text-ink">申诉处理</h2>

      <div className="flex flex-wrap items-end gap-3">
        {/* TODO(接口差异)：状态为服务端筛选占位，接口开放后接入并启用 */}
        <div className="w-[140px]">
          <Select
            label="状态"
            options={[
              { value: "all", label: "全部" },
              { value: "pending", label: "待处理" },
              { value: "resolved", label: "已处理" },
            ]}
            disabled
          />
        </div>
      </div>

      {/* 申诉表骨架：仅表头占位，数据行随申诉接口开放后渲染 */}
      <div className="overflow-x-auto rounded-lg border border-line bg-canvas">
        <table className="w-full border-collapse text-left">
          <thead>
            <tr className="border-b border-line text-[12px] text-ink-subtle">
              <th scope="col" className="py-3 pl-5 pr-4 font-medium">用户</th>
              <th scope="col" className="py-3 pr-4 font-medium">封禁原因</th>
              <th scope="col" className="py-3 pr-4 font-medium">申诉理由</th>
              <th scope="col" className="py-3 pr-4 font-medium">提交时间</th>
              <th scope="col" className="py-3 pr-4 font-medium">状态</th>
              <th scope="col" className="py-3 pr-4 font-medium">操作</th>
            </tr>
          </thead>
          <tbody />
        </table>
      </div>

      <EmptyState
        title="申诉接口随二期开放"
        description="封禁申诉由治理模块提供，接口开放后此处展示申诉列表与复核操作。"
      />
    </div>
  );
}
