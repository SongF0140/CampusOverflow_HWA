// 申诉处理视图测试（T-15-D 接真实数据）：列表渲染、状态筛选、复核提交。
import "@testing-library/jest-dom/vitest";

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fetchAppeals: vi.fn(),
  resolveAppeal: vi.fn(),
}));

vi.mock("@/api/governance", () => ({
  fetchAppeals: mocks.fetchAppeals,
  resolveAppeal: mocks.resolveAppeal,
  fetchModerationCases: vi.fn(),
  resolveModerationCase: vi.fn(),
}));

import { AppealsAdminView } from "./AppealsAdminView";

const APPEAL_PENDING = {
  id: 3, case_id: 9, user_id: 5, reason: "我认为处置有误，内容并不违规。",
  status: "pending", resolution_note: null, resolved_by: null, resolved_at: null,
  created_at: "2026-10-24T08:00:00Z",
};
const APPEAL_RESOLVED = {
  ...APPEAL_PENDING, id: 4, case_id: 10, user_id: 6,
  reason: "处罚过重，请求从轻处理并保留账号。",
  status: "rejected", resolution_note: "维持原处置",
};

beforeEach(() => {
  mocks.fetchAppeals.mockReset().mockResolvedValue({
    items: [APPEAL_PENDING, APPEAL_RESOLVED], total: 2, page: 1, page_size: 50,
  });
  mocks.resolveAppeal.mockReset().mockResolvedValue({
    data: { ...APPEAL_PENDING, status: "accepted" }, message: "申诉复核完成",
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("AppealsAdminView 申诉处理", () => {
  it("渲染申诉列表：申诉人/关联工单/理由/状态；待处理行有复核按钮", async () => {
    render(<AppealsAdminView />);
    expect(await screen.findByText("我认为处置有误，内容并不违规。")).toBeInTheDocument();
    expect(screen.getByText("工单 #9")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "复核" })).toBeInTheDocument();
    expect(screen.getByText("维持原处置")).toBeInTheDocument();
  });

  it("状态筛选联动（all 不传参）", async () => {
    render(<AppealsAdminView />);
    await screen.findByText("我认为处置有误，内容并不违规。");
    fireEvent.change(screen.getByLabelText("状态"), { target: { value: "accepted" } });
    await waitFor(() => {
      expect(mocks.fetchAppeals).toHaveBeenLastCalledWith(
        expect.objectContaining({ status: "accepted" }),
      );
    });
  });

  it("复核提交：确认框确认后调用 accepted 并提示", async () => {
    render(<AppealsAdminView />);
    fireEvent.click(await screen.findByRole("button", { name: "复核" }));
    // 复核说明可填；确认框 danger 提示撤销影响
    fireEvent.change(screen.getByLabelText(/复核说明/), {
      target: { value: "复核属实，恢复内容" },
    });
    fireEvent.click(await screen.findByRole("button", { name: "撤销处置" }));
    await waitFor(() => {
      expect(mocks.resolveAppeal).toHaveBeenCalledWith(3, {
        resolution: "accepted", resolution_note: "复核属实，恢复内容",
      });
    });
    expect(await screen.findByText("已撤销处置并通知当事人")).toBeInTheDocument();
  });
});
