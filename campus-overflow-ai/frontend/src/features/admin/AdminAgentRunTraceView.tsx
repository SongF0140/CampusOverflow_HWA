"use client";

// Agent 运行调用链详情（T-16-B，US-18）：运行信息 + 计划/步骤事件 + 工具调用 +
// 关联工单四段聚合；trace id 全程可追溯，失败原因醒目呈现。
import Link from "next/link";
import { useParams } from "next/navigation";

import { fetchAgentRunTrace } from "@/api/agent-runs";
import {
  Card,
  ErrorState,
  LoadingSkeleton,
} from "@/shared/components";
import { useAsyncData } from "@/shared/hooks/useAsyncData";

const TASK_TYPE_LABELS: Record<string, string> = {
  chat: "智能问答", suggest_tags: "标签推荐", similar_questions: "相似问题",
  moderation_scan: "风险扫描", doc_draft: "文档草稿", knowledge_tree: "大纲分析",
  teaching_report: "教学周报", moderation_patrol: "静默巡检",
};

const EVENT_LABELS: Record<string, string> = {
  plan: "生成计划", step_started: "步骤开始",
  step_succeeded: "步骤成功", step_failed: "步骤失败",
};

export function AdminAgentRunTraceView({ agentRunId }: { agentRunId: string }) {
  const state = useAsyncData(() => fetchAgentRunTrace(agentRunId), [agentRunId]);

  if (state.isLoading) return <LoadingSkeleton variant="detail" count={4} />;
  if (state.error !== null || !state.data) {
    return <ErrorState message={state.error ?? "运行不存在"} onRetry={state.reload} />;
  }

  const { run, events, tool_calls: toolCalls, related_cases: relatedCases } = state.data;

  return (
    <div className="flex flex-col gap-4">
      <nav className="text-[12px] text-ink-subtle" aria-label="面包屑">
        <Link href="/admin/agent/runs" className="co-focusable hover:text-brand">
          运行记录
        </Link>
        <span className="mx-1.5" aria-hidden="true">/</span>
        <span className="font-mono">{run.agent_run_id}</span>
      </nav>

      <Card className="flex flex-col gap-3 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-[18px] font-semibold text-ink">
            {TASK_TYPE_LABELS[run.task_type] ?? run.task_type}
            <span className={`ml-3 text-[13px] font-normal ${run.status === "failed" ? "text-red-600" : "text-ink-muted"}`}>
              {run.status === "succeeded" ? "已成功" : run.status === "failed" ? "已失败" : "运行中"}
            </span>
          </h2>
          <span className="font-mono text-[12px] text-ink-subtle">
            trace: {run.trace_id}
          </span>
        </div>
        <p className="text-[13px] text-ink-muted">
          {run.user_id ? `归属：用户 #${run.user_id}` : "归属：系统运行"} ·
          开始 {new Date(run.created_at).toLocaleString("zh-CN")}
        </p>
        {run.error_summary ? (
          <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-[13px] text-red-700">
            失败原因：{run.error_summary}
          </div>
        ) : null}
        {run.output_summary ? (
          <p className="text-[13px] text-ink-muted">结果摘要：{run.output_summary}</p>
        ) : null}
      </Card>

      <Card className="flex flex-col gap-2 p-5">
        <h3 className="text-[15px] font-semibold text-ink">计划与步骤</h3>
        {events.length === 0 ? (
          <p className="text-[13px] text-ink-subtle">无事件记录。</p>
        ) : (
          <ol className="flex flex-col gap-1 text-[13px]">
            {events.map((event) => (
              <li key={event.id} className="flex flex-wrap items-center gap-2">
                <span className="text-ink-subtle">#{event.sequence_no}</span>
                <span>{EVENT_LABELS[event.event_type] ?? event.event_type}</span>
                {event.tool_name ? (
                  <span className="rounded bg-panel px-1.5 text-[12px]">{event.tool_name}</span>
                ) : null}
                {event.duration_ms !== null && event.duration_ms !== undefined ? (
                  <span className="text-[12px] text-ink-subtle">{event.duration_ms}ms</span>
                ) : null}
                <span className="text-[12px] text-ink-subtle">版本 v{event.plan_revision}</span>
              </li>
            ))}
          </ol>
        )}
      </Card>

      <Card className="flex flex-col gap-2 p-5">
        <h3 className="text-[15px] font-semibold text-ink">工具调用</h3>
        {toolCalls.length === 0 ? (
          <p className="text-[13px] text-ink-subtle">无工具调用。</p>
        ) : (
          <ul className="flex flex-col gap-2 text-[13px]">
            {toolCalls.map((call) => (
              <li key={call.id} className="rounded-md border border-line-subtle px-3 py-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{call.tool_name}</span>
                  <span className={call.status === "succeeded" ? "text-emerald-700" : "text-red-600"}>
                    {call.status === "succeeded" ? "成功" : "失败"}
                  </span>
                  {call.duration_ms !== null && call.duration_ms !== undefined ? (
                    <span className="text-[12px] text-ink-subtle">{call.duration_ms}ms</span>
                  ) : null}
                </div>
                <p className="mt-1 text-[12px] text-ink-subtle">
                  参数：{call.args_summary ?? "—"} · 结果：{call.result_summary ?? "—"}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card className="flex flex-col gap-2 p-5">
        <h3 className="text-[15px] font-semibold text-ink">关联治理工单</h3>
        {relatedCases.length === 0 ? (
          <p className="text-[13px] text-ink-subtle">本运行未关联工单。</p>
        ) : (
          <ul className="flex flex-col gap-1 text-[13px]">
            {relatedCases.map((item) => (
              <li key={item.id}>
                <Link
                  href={`/admin/moderation/approvals?case_id=${item.id}`}
                  className="co-focusable text-brand hover:underline"
                >
                  工单 #{item.id}
                </Link>
                <span className="ml-2 text-ink-muted">{item.reason}</span>
                <span className="ml-2 text-[12px] text-ink-subtle">{item.status}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
