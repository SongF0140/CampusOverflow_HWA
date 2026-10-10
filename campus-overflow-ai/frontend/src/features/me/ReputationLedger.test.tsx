import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getMyReputation: vi.fn(),
}));

vi.mock("@/api/reputation", () => ({
  getMyReputation: mocks.getMyReputation,
}));

import { ApiError } from "@/api/client";

import { ReputationLedger } from "./ReputationLedger";

const PAGE_ONE = {
  score: 36,
  logs: [
    {
      delta: 5,
      reason: "回答被采纳",
      ref_type: "answer",
      ref_id: 12,
      created_at: "2026-10-05T10:00:00+08:00",
    },
    {
      delta: -2,
      reason: "投票被取消",
      ref_type: "question",
      ref_id: 3,
      created_at: "2026-10-04T10:00:00+08:00",
    },
  ],
  total: 12,
  page: 1,
  page_size: 10,
};

describe("ReputationLedger", () => {
  beforeEach(() => {
    mocks.getMyReputation.mockResolvedValue(PAGE_ONE);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("流水渲染：正变动红 +、负变动绿 −，余额按当前声望倒推", async () => {
    render(<ReputationLedger />);

    expect(await screen.findByText("回答被采纳")).toBeTruthy();

    const gainRow = screen.getByRole("row", { name: /回答被采纳/ });
    expect(gainRow.textContent).toContain("+5");
    expect(gainRow.textContent).toContain("36");

    const lossRow = screen.getByRole("row", { name: /投票被取消/ });
    expect(lossRow.textContent).toContain("-2");
    // 余额 = 36 − 上方行变动（+5）= 31
    expect(lossRow.textContent).toContain("31");

    const gainCell = gainRow.querySelector(".text-danger-ink");
    expect(gainCell).not.toBeNull();
    const lossCell = lossRow.querySelector(".text-success-ink");
    expect(lossCell).not.toBeNull();
  });

  it("分页：点击下一页以 page=2 重拉流水", async () => {
    render(<ReputationLedger />);

    fireEvent.click(await screen.findByRole("button", { name: "下一页" }));

    await waitFor(() => {
      expect(mocks.getMyReputation).toHaveBeenCalledWith(
        expect.objectContaining({ page: 2, page_size: 10 }),
      );
    });
  });

  it("无流水渲染空态", async () => {
    mocks.getMyReputation.mockResolvedValue({
      score: 0,
      logs: [],
      total: 0,
      page: 1,
      page_size: 10,
    });
    render(<ReputationLedger />);

    expect(await screen.findByText("暂无声望变动")).toBeTruthy();
  });

  it("加载失败渲染错误态与重试", async () => {
    mocks.getMyReputation.mockRejectedValue(new ApiError(500, "服务暂时不可用"));
    render(<ReputationLedger />);

    expect(await screen.findByText("加载失败")).toBeTruthy();
    expect(screen.getByRole("button", { name: "重新加载" })).toBeTruthy();
  });
});
