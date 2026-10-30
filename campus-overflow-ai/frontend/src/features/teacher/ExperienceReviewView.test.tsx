import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ fetchExperienceProposals: vi.fn(), reviewExperience: vi.fn() }));
vi.mock("@/api/experiences", () => mocks);

import { ExperienceReviewView } from "./ExperienceReviewView";

const row = { id: 1, proposal_id: "uuid", course_id: 1, title: "先核验条件",
  summary: "核对题目限制与教材证据", steps: ["列出题目条件", "读取原文"], status: "pending" };
beforeEach(() => {
  mocks.fetchExperienceProposals.mockReset().mockResolvedValue({ items: [row], total: 1 });
  mocks.reviewExperience.mockReset().mockResolvedValue({ ...row, status: "published" });
});
afterEach(cleanup);

describe("教师回答经验审核", () => {
  it("展示建议全文并明确等待教师确认，点击发布后刷新", async () => {
    render(<ExperienceReviewView courseId={1} />);
    await screen.findByText("先核验条件");
    expect(screen.getByText("列出题目条件")).toBeTruthy();
    expect(mocks.reviewExperience).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "确认发布" }));
    await waitFor(() => expect(mocks.reviewExperience).toHaveBeenCalledWith(1, "publish"));
    await waitFor(() => expect(mocks.fetchExperienceProposals).toHaveBeenCalledTimes(2));
    expect(screen.getByText("经验状态已更新")).toBeTruthy();
  });
  it("待审建议可拒绝，已发布经验可撤回", async () => {
    mocks.fetchExperienceProposals.mockResolvedValue({ items: [row, { ...row, id: 2, title: "已发布流程", status: "published" }], total: 2 });
    render(<ExperienceReviewView courseId={1} />);
    await screen.findByText("已发布流程");
    fireEvent.click(screen.getByRole("button", { name: "拒绝建议" }));
    await waitFor(() => expect(mocks.reviewExperience).toHaveBeenCalledWith(1, "reject"));
    fireEvent.click(screen.getByRole("button", { name: "撤回发布" }));
    await waitFor(() => expect(mocks.reviewExperience).toHaveBeenCalledWith(2, "withdraw"));
  });
  it("显示空态和加载失败，不显示可审核的旧数据", async () => {
    mocks.fetchExperienceProposals.mockResolvedValue({ items: [], total: 0 });
    const view = render(<ExperienceReviewView courseId={1} />);
    await screen.findByText("暂无回答经验建议");
    mocks.fetchExperienceProposals.mockRejectedValue(new Error("仅负责教师可审核"));
    view.rerender(<ExperienceReviewView courseId={2} />);
    await screen.findByText("仅负责教师可审核");
    expect(screen.queryByRole("button", { name: "确认发布" })).toBeNull();
  });
  it("发布失败显示错误并保留建议以便重试", async () => {
    mocks.reviewExperience.mockRejectedValue(new Error("经验状态已变化"));
    render(<ExperienceReviewView courseId={1} />);
    await screen.findByText("先核验条件");
    fireEvent.click(screen.getByRole("button", { name: "确认发布" }));
    await screen.findByText("经验状态已变化");
    expect(screen.getByRole("button", { name: "确认发布" }).hasAttribute("disabled")).toBe(false);
  });
});
