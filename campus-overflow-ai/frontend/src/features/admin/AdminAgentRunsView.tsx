"use client";

// Agent 运行列表（T-16-B，US-18）：状态/任务类型筛选 + 运行表 + 详情入口。
// 数据源 GET /api/governance/agent-runs（仅管理员）；失败运行以醒目样式呈现。
import { useState } from "react";
import Link from "next/link";

import { fetchAgentRuns } from "@/api/agent-runs";
import {
  EmptyState,
  ErrorState,
  LoadingSkeleton,
  Select,
  TabNav,
} from "@/shared/components";
import { useAsyncData } from "@/shared/hooks/useAsyncData";

const STATUS_TABS = [
  { key: "all", label: "全部" },
  { key: "running", label: "运行中" },
  { key: "succeeded", label: "已成功" },
  { key: "failed", label: "已失败" },
];

const TASK_TYPE_LABELS: Record<string, string> = {
  chat: "智能问答", suggest_tags: "标签推荐", similar_questions: "相似问题",
  moderation_scan: "风险扫描", doc_draft: "文档草稿", knowledge_tree: "大纲分析",
  teaching_report: "教学周报", moderation_patrol: "静默巡检",
};

const STATUS_LABELS: Record<string, string> = {
  running: "运行中", succeeded: "已成功", failed: "已失败",
};

export function AdminAgentRunsView() {
  const [status, setStatus] = useState("all");
  const [taskType, setTaskType] = useState("all");

  const state = useAsyncData(
    () => fetchAgentRuns({
      status: status === "all" ? undefined : status,
      task_type: taskType === "all" ? undefined : taskType,
      page: 1,
      page_size: 50,
    }),
    [status, taskType],
  );
  const runs = state.data?.items ?? [];

  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-[22px] font-semibold text-ink">Agent 运行记录</h2>

      <div className="flex flex-wrap items-end gap-3">
        <div className="w-[160px]">
          <Select
            label="任务类型"
            value={taskType}
            onChange={(event) => setTaskType(event.target.value)}
            options={[
              { value: "all", label: "全部类型" },
              ...Object.entries(TASK_TYPE_LABELS).map(([value, label]) => ({
                value, label,
              })),
            ]}
          />
        </div>
      </div>

      <TabNav tabs={STATUS_TABS} active={status} onChange={setStatus} />

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
                  <th scope="col" className="py-3 pl-5 pr-4 font-medium">运行 ID</th>
                  <th scope="col" className="py-3 pr-4 font-medium">任务类型</th>
                  <th scope="col" className="py-3 pr-4 font-medium">归属用户</th>
                  <th scope="col" className="py-3 pr-4 font-medium">状态</th>
                  <th scope="col" className="py-3 pr-4 font-medium">摘要</th>
                  <th scope="col" className="py-3 pr-4 font-medium">时间</th>
                  <th scope="col" className="py-3 pr-4 font-medium">操作</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((run) => (
                  <tr
                    key={run.agent_run_id}
                    className={`border-b border-line-subtle text-[13px] ${
                      run.status === "failed" ? "bg-red-50/50" : ""
                    }`}
                  >
                    <td className="py-3 pl-5 pr-4 font-mono text-[12px]">
                      {run.agent_run_id.slice(0, 8)}…
                    </td>
                    <td className="py-3 pr-4">
                      {TASK_TYPE_LABELS[run.task_type] ?? run.task_type}
                    </td>
                    <td className="py-3 pr-4">
                      {run.user_id ? `用户 #${run.user_id}` : "系统"}
                    </td>
                    <td className="py-3 pr-4">
                      <span className={run.status === "failed" ? "text-red-600" : ""}>
                        {STATUS_LABELS[run.status] ?? run.status}
                      </span>
                      {run.error_summary ? (
                        <span className="ml-2 text-[12px] text-ink-subtle" title={run.error_summary}>
                          {run.error_summary.slice(0, 20)}
                        </span>
                      ) : null}
                    </td>
                    <td className="max-w-[240px] truncate py-3 pr-4" title={run.input_summary}>
                      {run.input_summary}
                    </td>
                    <td className="py-3 pr-4 text-[12px]">
                      {new Date(run.created_at).toLocaleString("zh-CN")}
                    </td>
                    <td className="py-3 pr-4">
                      <Link
                        href={`/admin/agent/runs/${run.agent_run_id}`}
                        className="co-focusable text-brand hover:underline"
                      >
                        调用链
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {runs.length === 0 ? (
            <EmptyState
              title="暂无运行记录"
              description="当前筛选条件下没有 Agent 运行。用户使用智能功能或系统调度触发后此处展示。"
            />
          ) : (
            <p className="text-[12px] text-ink-subtle">共 {state.data?.total ?? 0} 条</p>
          )}
        </>
      ) : null}
    </div>
  );
}
