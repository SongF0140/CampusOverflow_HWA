// 审核队列视图测试（T-15-D 接真实数据）：列表渲染、状态/来源筛选联动、处理入口。
import "@testing-library/jest-dom/vitest";

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fetchModerationCases: vi.fn(),
}));

vi.mock("@/api/governance", () => ({
  fetchModerationCases: mocks.fetchModerationCases,
  resolveModerationCase: vi.fn(),
  fetchAppeals: vi.fn(),
  resolveAppeal: vi.fn(),
}));

import { ModerationCasesView } from "./ModerationCasesView";

const CASE_PENDING = {
  id: 7, target_type: "question", target_id: 3, risk_level: "high", source: "agent",
  reason: "疑似辱骂攻击", snapshot: "{}", status: "pending", resolution: null,
  resolved_by: null, resolved_at: null, manager_feedback: null, agent_decision: null,
  decision_trace: null, trace_id: "t", agent_run_id: "run-1", created_at: "2026-10-24T00:00:00Z",
};
const CASE_EXECUTED = {
  ...CASE_PENDING, id: 8, status: "executed", resolution: "hide",
  target_id: 4, reason: "广告灌水内容",
};

beforeEach(() => {
  mocks.fetchModerationCases.mockReset().mockResolvedValue({
    items: [CASE_PENDING, CASE_EXECUTED], total: 2, page: 1, page_size: 50,
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("ModerationCasesView 审核队列", () => {
  it("渲染工单列表：目标/风险/来源/状态与原因；待处理行有处理入口", async () => {
    render(<ModerationCasesView />);
    expect(await screen.findByText("疑似辱骂攻击")).toBeInTheDocument();
    expect(screen.getByText("问题 #3")).toBeInTheDocument();
    expect(screen.getAllByText("Agent").length).toBeGreaterThanOrEqual(2);
    // 待处理 → 处理链接
    expect(screen.getByRole("link", { name: "处理" })).toHaveAttribute(
      "href", "/admin/moderation/approvals?case_id=7",
    );
    expect(screen.getByText("#8")).toBeInTheDocument();
  });

  it("状态 Tab 切换重新拉取（带 status 参数）", async () => {
    render(<ModerationCasesView />);
    await screen.findByText("疑似辱骂攻击");
    expect(mocks.fetchModerationCases).toHaveBeenCalledWith(
      expect.objectContaining({ status: "pending" }),
    );

    fireEvent.click(screen.getByRole("tab", { name: "已执行" }));
    await waitFor(() => {
      expect(mocks.fetchModerationCases).toHaveBeenLastCalledWith(
        expect.objectContaining({ status: "executed" }),
      );
    });
  });

  it("来源筛选联动（all 不传参）", async () => {
    render(<ModerationCasesView />);
    await screen.findByText("疑似辱骂攻击");
    fireEvent.change(screen.getByLabelText("来源"), { target: { value: "agent" } });
    await waitFor(() => {
      expect(mocks.fetchModerationCases).toHaveBeenLastCalledWith(
        expect.objectContaining({ source: "agent" }),
      );
    });
    fireEvent.change(screen.getByLabelText("来源"), { target: { value: "all" } });
    await waitFor(() => {
      expect(mocks.fetchModerationCases).toHaveBeenLastCalledWith(
        expect.objectContaining({ source: undefined }),
      );
    });
  });

  it("空列表渲染空态说明", async () => {
    mocks.fetchModerationCases.mockResolvedValue({
      items: [], total: 0, page: 1, page_size: 50,
    });
    render(<ModerationCasesView />);
    expect(await screen.findByText("暂无工单")).toBeInTheDocument();
  });
});
