// Agent 运行列表视图测试（T-16-B，US-18）：列表渲染、筛选联动、失败样式、详情入口。
import "@testing-library/jest-dom/vitest";

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fetchAgentRuns: vi.fn(),
}));

vi.mock("@/api/agent-runs", () => ({
  fetchAgentRuns: mocks.fetchAgentRuns,
  fetchAgentRunTrace: vi.fn(),
}));

import { AdminAgentRunsView } from "./AdminAgentRunsView";

const RUN_OK = {
  id: 1, user_id: 3, task_type: "chat", trace_id: "trace-a",
  agent_run_id: "aaaaaaaa-1111", input_summary: "用户任务：chat",
  output_summary: "任务已完成", error_summary: null, status: "succeeded",
  created_at: "2026-10-24T09:00:00Z", updated_at: "2026-10-24T09:00:10Z",
};
const RUN_FAILED = {
  ...RUN_OK, id: 2, agent_run_id: "bbbbbbbb-2222", status: "failed",
  task_type: "moderation_patrol", user_id: null,
  input_summary: "静默巡检：近 1 小时新内容", error_summary: "巡检清单读取失败",
};

beforeEach(() => {
  mocks.fetchAgentRuns.mockReset().mockResolvedValue({
    items: [RUN_OK, RUN_FAILED], total: 2, page: 1, page_size: 50,
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("AdminAgentRunsView 运行记录", () => {
  it("渲染运行列表：类型/归属/状态/失败原因与详情入口", async () => {
    render(<AdminAgentRunsView />);
    expect(await screen.findByText("静默巡检：近 1 小时新内容")).toBeInTheDocument();
    expect(screen.getByText("用户 #3")).toBeInTheDocument();
    expect(screen.getByText("系统")).toBeInTheDocument();
    // 失败原因可见（US-18：失败运行可定位）
    expect(screen.getByTitle("巡检清单读取失败")).toBeInTheDocument();
    // 详情入口链接（两条运行各一条）
    const links = screen.getAllByRole("link", { name: "调用链" });
    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      "/admin/agent/runs/aaaaaaaa-1111", "/admin/agent/runs/bbbbbbbb-2222",
    ]);
  });

  it("状态 Tab 与任务类型筛选联动（all 不传参）", async () => {
    render(<AdminAgentRunsView />);
    await screen.findByText("静默巡检：近 1 小时新内容");

    fireEvent.click(screen.getByRole("tab", { name: "已失败" }));
    await waitFor(() => {
      expect(mocks.fetchAgentRuns).toHaveBeenLastCalledWith(
        expect.objectContaining({ status: "failed" }),
      );
    });

    fireEvent.change(screen.getByLabelText("任务类型"), { target: { value: "chat" } });
    await waitFor(() => {
      expect(mocks.fetchAgentRuns).toHaveBeenLastCalledWith(
        expect.objectContaining({ status: "failed", task_type: "chat" }),
      );
    });
  });

  it("空列表渲染空态说明", async () => {
    mocks.fetchAgentRuns.mockResolvedValue({
      items: [], total: 0, page: 1, page_size: 50,
    });
    render(<AdminAgentRunsView />);
    expect(await screen.findByText("暂无运行记录")).toBeInTheDocument();
  });
});
