// 审批中心视图测试（T-15-D 接真实数据）：队列渲染、工单选择、处置动作条件渲染与二次确认。
import "@testing-library/jest-dom/vitest";

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fetchModerationCases: vi.fn(),
  resolveModerationCase: vi.fn(),
  searchParams: new URLSearchParams(),
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => mocks.searchParams,
}));

vi.mock("@/api/governance", () => ({
  fetchModerationCases: mocks.fetchModerationCases,
  resolveModerationCase: mocks.resolveModerationCase,
  fetchAppeals: vi.fn(),
  resolveAppeal: vi.fn(),
}));

import { ApprovalCenterView } from "./ApprovalCenterView";
import { useSessionStore } from "@/shared/stores/session-store";
import type { UserMe } from "@/shared/types/auth";

const USER_CASE = {
  id: 9, target_type: "user", target_id: 5, risk_level: "high", source: "agent",
  reason: "多次辱骂用户", snapshot: "{}", status: "pending", resolution: null,
  resolved_by: null, resolved_at: null, manager_feedback: null, agent_decision: null,
  decision_trace: "[2026-10-24T00:00:00Z] 建单", trace_id: "t",
  agent_run_id: "run-abc12345", created_at: "2026-10-24T00:00:00Z",
};
const CONTENT_CASE = {
  ...USER_CASE, id: 10, target_type: "question", target_id: 3,
  reason: "垃圾广告内容", decision_trace: null, agent_run_id: null,
};

beforeEach(() => {
  mocks.fetchModerationCases.mockReset().mockResolvedValue({
    items: [USER_CASE, CONTENT_CASE], total: 2, page: 1, page_size: 50,
  });
  mocks.resolveModerationCase.mockReset().mockResolvedValue({
    data: { ...USER_CASE, status: "executed" }, message: "工单处置完成",
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  useSessionStore.setState({ me: null });
});

it("v2工单不展示旧处置表单，也不调用resolve", async () => {
  const id = "00000000-0000-4000-8000-000000000001";
  useSessionStore.setState({ me: { id: 1, role: "admin" } as UserMe });
  mocks.fetchModerationCases.mockResolvedValue({ items: [{ ...CONTENT_CASE,
    snapshot: JSON.stringify({ contract: "approval-v2", request_id: id }) }], total: 1 });
  vi.stubGlobal("fetch", async () => Response.json({ code: 200, data: { contract_version: 2, request_id: id,
    case_id: 10, status: "pending", executed: false, expires_at: "2099-11-05T00:00:00Z", args_hash: "a".repeat(64),
    frozen_call: { target_type: "question", target_id: 3, action: "hide", reason: "冻结原因", expected_version: "v", tool_name: "executeApprovedGovernance" } } }));
  render(<ApprovalCenterView />);
  fireEvent.click(await screen.findByRole("button", { name: /#10 问题 #3/ }));
  await screen.findByRole("button", { name: "批准此动作" });
  expect(screen.queryByRole("button", { name: "执行处置" })).toBeNull();
  expect(mocks.resolveModerationCase).not.toHaveBeenCalled();
});

describe("ApprovalCenterView 审批中心", () => {
  it("队列渲染与工单选择：详情展示原因/运行标识与时间线", async () => {
    render(<ApprovalCenterView />);
    const queueButton = await screen.findByRole("button", { name: /#9 用户 #5/ });
    fireEvent.click(queueButton);
    expect(await screen.findByText("工单 #9：用户 #5")).toBeInTheDocument();
    // 详情行文本被 JSX 插值拆分：以容器 textContent 断言合并结果（运行号截断 8 位）
    expect(document.body.textContent).toContain("风险 high · 来源 Agent · 运行 run-abc1");
    expect(screen.getByText(/建单/)).toBeInTheDocument();
  });

  it("用户类工单渲染封禁/警告动作组，内容类工单渲染隐藏/删除动作组", async () => {
    render(<ApprovalCenterView />);
    fireEvent.click(await screen.findByRole("button", { name: /#9 用户 #5/ }));
    const userSelect = (await screen.findByLabelText("处置动作")) as HTMLSelectElement;
    const userOptions = Array.from(userSelect.options).map((option) => option.value);
    expect(userOptions).toEqual(["", "warn", "ban_temp", "ban", "skip"]);

    fireEvent.click(screen.getByText("垃圾广告内容"));
    await waitFor(() => {
      const contentSelect = screen.getByLabelText("处置动作") as HTMLSelectElement;
      const contentOptions = Array.from(contentSelect.options).map((option) => option.value);
      expect(contentOptions).toEqual(["", "hide", "delete", "skip"]);
    });
  });

  it("hide（非 danger）直接提交；成功后 Toast 并刷新队列", async () => {
    render(<ApprovalCenterView />);
    fireEvent.click(await screen.findByText("垃圾广告内容"));
    fireEvent.change(await screen.findByLabelText("处置动作"), { target: { value: "hide" } });
    fireEvent.click(screen.getByRole("button", { name: "执行处置" }));
    await waitFor(() => {
      expect(mocks.resolveModerationCase).toHaveBeenCalledWith(10, {
        decision: "hide", manager_feedback: "管理员处置",
      });
    });
    expect(await screen.findByText("已处置并通知当事人")).toBeInTheDocument();
  });

  it("ban_temp 需二次确认并携带天数；danger 动作先弹确认框", async () => {
    render(<ApprovalCenterView />);
    fireEvent.click(await screen.findByRole("button", { name: /#9 用户 #5/ }));
    fireEvent.change(await screen.findByLabelText("处置动作"), { target: { value: "ban_temp" } });
    fireEvent.change(screen.getByLabelText(/封禁天数/), { target: { value: "14" } });
    fireEvent.click(screen.getByRole("button", { name: "执行处置" }));
    // 二次确认框出现，尚未提交
    expect(screen.getByText("确认处置工单 #9")).toBeInTheDocument();
    expect(mocks.resolveModerationCase).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "确认执行" }));
    await waitFor(() => {
      expect(mocks.resolveModerationCase).toHaveBeenCalledWith(9, {
        decision: "ban_temp", manager_feedback: "管理员处置", duration_days: 14,
      });
    });
  });
});
