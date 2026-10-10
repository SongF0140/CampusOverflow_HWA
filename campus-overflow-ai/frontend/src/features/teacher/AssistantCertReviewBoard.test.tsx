import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listAssistantCertifications: vi.fn(),
  reviewAssistantCertification: vi.fn(),
}));

vi.mock("@/api/users", () => ({
  listAssistantCertifications: mocks.listAssistantCertifications,
  reviewAssistantCertification: mocks.reviewAssistantCertification,
}));

import { AssistantCertReviewBoard } from "./AssistantCertReviewBoard";

const PENDING_ITEM = {
  user_id: 8,
  username: "student01",
  certification_status: "pending",
  applied_at: "2026-10-05T10:00:00+08:00",
};

function paged(items: unknown[], total = items.length) {
  return { items, total, page: 1, page_size: 20 };
}

beforeEach(() => {
  mocks.listAssistantCertifications.mockReset().mockResolvedValue(paged([PENDING_ITEM]));
  mocks.reviewAssistantCertification.mockReset().mockResolvedValue({
    id: 8,
    username: "student01",
    assistant_cert_status: "approved",
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("AssistantCertReviewBoard", () => {
  it("默认拉待审核列表（status=pending），行高信息含申请人", async () => {
    render(<AssistantCertReviewBoard />);

    expect(await screen.findByText("student01")).toBeTruthy();
    expect(mocks.listAssistantCertifications).toHaveBeenCalledWith({
      status: "pending",
      page: 1,
      page_size: 20,
    });
  });

  it("通过：二次确认后调 review(approve) 并刷新列表 + Toast", async () => {
    render(<AssistantCertReviewBoard />);

    fireEvent.click(await screen.findByRole("button", { name: "通过" }));
    expect(await screen.findByText("通过该助教认证申请？")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "确认通过" }));

    await waitFor(() => expect(mocks.reviewAssistantCertification).toHaveBeenCalledWith(8, "approve"));
    expect(await screen.findByText("已通过助教认证")).toBeTruthy();
    // 初次加载 1 次 + 审核成功后 reload 1 次
    await waitFor(() => expect(mocks.listAssistantCertifications).toHaveBeenCalledTimes(2));
  });

  it("驳回：二次确认（danger）后调 review(reject)", async () => {
    render(<AssistantCertReviewBoard />);

    fireEvent.click(await screen.findByRole("button", { name: "驳回" }));
    fireEvent.click(await screen.findByRole("button", { name: "确认驳回" }));

    await waitFor(() => expect(mocks.reviewAssistantCertification).toHaveBeenCalledWith(8, "reject"));
    expect(await screen.findByText("已驳回该申请")).toBeTruthy();
  });

  it("切换到已通过 Tab：按状态重拉，且不再渲染审核按钮", async () => {
    mocks.listAssistantCertifications.mockResolvedValue(
      paged([{ ...PENDING_ITEM, certification_status: "approved" }]),
    );
    render(<AssistantCertReviewBoard />);

    fireEvent.click(await screen.findByRole("tab", { name: "已通过" }));

    await waitFor(() =>
      expect(mocks.listAssistantCertifications).toHaveBeenLastCalledWith({
        status: "approved",
        page: 1,
        page_size: 20,
      }),
    );
    expect(screen.queryByRole("button", { name: "通过" })).toBeNull();
  });

  it("空态：说明为什么空", async () => {
    mocks.listAssistantCertifications.mockResolvedValue(paged([]));
    render(<AssistantCertReviewBoard />);

    expect(await screen.findByText("暂无待审核申请")).toBeTruthy();
  });

  it("拉取失败：中文错误 + 重试重新请求", async () => {
    mocks.listAssistantCertifications.mockRejectedValueOnce(new Error("网络异常"));
    render(<AssistantCertReviewBoard />);

    expect(await screen.findByText("网络异常")).toBeTruthy();
    mocks.listAssistantCertifications.mockResolvedValue(paged([PENDING_ITEM]));
    fireEvent.click(screen.getByRole("button", { name: "重新加载" }));

    expect(await screen.findByText("student01")).toBeTruthy();
  });
});
