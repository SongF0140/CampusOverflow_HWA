// Agent 运行调用链详情测试（T-16-B，US-18）：四段聚合渲染、失败原因、关联工单链接。
import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fetchAgentRunTrace: vi.fn(),
}));

vi.mock("@/api/agent-runs", () => ({
  fetchAgentRunTrace: mocks.fetchAgentRunTrace,
  fetchAgentRuns: vi.fn(),
}));

import { AdminAgentRunTraceView } from "./AdminAgentRunTraceView";

const TRACE = {
  run: {
    id: 1, user_id: 3, task_type: "moderation_patrol", trace_id: "trace-c",
    agent_run_id: "cccccccc-3333", input_summary: "静默巡检：近 1 小时新内容",
    output_summary: "扫描 3 条，升级 1 条", error_summary: null, status: "succeeded",
    created_at: "2026-10-24T09:00:00Z", updated_at: "2026-10-24T09:01:00Z",
  },
  events: [
    {
      id: 1, agent_run_id: "cccccccc-3333", sequence_no: 1, event_type: "plan",
      plan_revision: 1, steps: [{ step_id: "s1", tool_name: "fetchKnowledgeTree" }],
      step_id: null, tool_name: null, duration_ms: null, trace_id: "trace-c",
      created_at: "2026-10-24T09:00:05Z",
    },
    {
      id: 2, agent_run_id: "cccccccc-3333", sequence_no: 2,
      event_type: "step_succeeded", plan_revision: 1, steps: null,
      step_id: "s1", tool_name: "fetchKnowledgeTree", duration_ms: 90,
      trace_id: "trace-c", created_at: "2026-10-24T09:00:06Z",
    },
  ],
  tool_calls: [
    {
      id: 1, agent_run_id: "cccccccc-3333", tool_name: "fetchKnowledgeTree",
      args_summary: "courseId=2", result_summary: "5 个节点", status: "succeeded",
      duration_ms: 90, trace_id: "trace-c", created_at: "2026-10-24T09:00:06Z",
    },
  ],
  related_cases: [
    {
      id: 12, target_type: "question", target_id: 3, risk_level: "high",
      source: "agent", reason: "巡检发现疑似违规", snapshot: "{}", status: "pending",
      resolution: null, resolved_by: null, resolved_at: null, manager_feedback: null,
      agent_decision: null, decision_trace: null, trace_id: "trace-c",
      agent_run_id: "cccccccc-3333", created_at: "2026-10-24T09:00:10Z",
    },
  ],
};

beforeEach(() => {
  mocks.fetchAgentRunTrace.mockReset().mockResolvedValue(TRACE);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("AdminAgentRunTraceView 运行调用链", () => {
  it("四段聚合渲染：运行信息/计划事件/工具调用/关联工单", async () => {
    render(<AdminAgentRunTraceView agentRunId="cccccccc-3333" />);
    // 详情行文本被 JSX 插值拆分：以容器 textContent 断言合并结果
    await waitFor(() => {
      expect(document.body.textContent).toContain("静默巡检");
      expect(document.body.textContent).toContain("trace: trace-c");
    });
    expect(screen.getByText("生成计划")).toBeInTheDocument();
    expect(screen.getByText("步骤成功")).toBeInTheDocument();
    expect(screen.getAllByText("fetchKnowledgeTree").length).toBe(2);
    // 工具调用参数/结果为插值拆分文本：容器断言
    expect(document.body.textContent).toContain("参数：courseId=2 · 结果：5 个节点");
    expect(screen.getByText("结果摘要：扫描 3 条，升级 1 条")).toBeInTheDocument();
    // 关联工单链接直达审批中心
    expect(screen.getByRole("link", { name: "工单 #12" })).toHaveAttribute(
      "href", "/admin/moderation/approvals?case_id=12",
    );
  });

  it("失败运行醒目呈现失败原因", async () => {
    mocks.fetchAgentRunTrace.mockResolvedValue({
      ...TRACE,
      run: { ...TRACE.run, status: "failed", error_summary: "巡检清单读取失败" },
    });
    render(<AdminAgentRunTraceView agentRunId="cccccccc-3333" />);
    expect(await screen.findByText(/失败原因：巡检清单读取失败/)).toBeInTheDocument();
  });

  it("运行不存在时渲染错误态", async () => {
    mocks.fetchAgentRunTrace.mockRejectedValue(new Error("运行不存在"));
    render(<AdminAgentRunTraceView agentRunId="missing" />);
    // ErrorState 由 useAsyncData 错误路径渲染
    expect(await screen.findByText(/运行不存在/)).toBeInTheDocument();
  });
});
