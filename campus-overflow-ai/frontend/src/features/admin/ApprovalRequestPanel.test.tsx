import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ fetch: vi.fn(), me: { id: 7, role: "admin" } }));
vi.mock("@/shared/stores/session-store", () => ({ useSessionStore: (select: (state: unknown) => unknown) => select({ me: mocks.me }) }));
import { ApprovalRequestPanel } from "./ApprovalRequestPanel";

const version = "a".repeat(64);
const saved = { request_id: "f81d4fae-7dec-41d0-a765-00a0c91e6bf6", case_id: 9, status: "pending", repeat: false };
const envelope = (data: unknown) => Response.json({ code: 200, data, message: "成功" });
beforeEach(() => {
  localStorage.clear(); mocks.fetch.mockReset(); mocks.me.id = 7;
  vi.stubGlobal("fetch", mocks.fetch);
  mocks.fetch.mockImplementation(async (url, init) => {
    if (String(url).endsWith("/preview")) return envelope({ current_state: "ready", effect: "隐藏后不再公开展示", state_version: version, can_request_approval: true });
    if (init?.method === "POST") return envelope(saved);
    return envelope({ ...saved, state: "waiting", case_status: "pending", executed: false, expires_at: "2026-11-04T00:00:00Z" });
  });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const preview = async () => {
  fireEvent.change(screen.getByLabelText("目标编号"), { target: { value: "3" } });
  fireEvent.change(screen.getByLabelText("治理原因"), { target: { value: "请核查广告" } });
  fireEvent.click(screen.getByRole("button", { name: "读取现状并预览" }));
  await screen.findByText("隐藏后不再公开展示");
};

describe("管理员审批申请面板", () => {
  it("先展示事实，再人工提交冻结参数；不自动治理", async () => {
    render(<ApprovalRequestPanel />);
    await preview();
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "提交待审核" }));
    await screen.findByText(/工单 #9/);
    const [url, init] = mocks.fetch.mock.calls[1];
    expect(url).toBe("/api/agent/agent/approvals/requests");
    expect(JSON.parse(init.body)).toMatchObject({ target_type: "question", target_id: 3, action: "hide", reason: "请核查广告", expected_version: version });
    expect(mocks.fetch.mock.calls.some(call => String(call[0]).includes("resolve"))).toBe(false);
    expect(localStorage.getItem("co_approval_user_7")).toContain("request_id");
  });
  it("参数变化后不能提交旧预览", async () => {
    render(<ApprovalRequestPanel />);
    await preview();
    fireEvent.change(screen.getByLabelText("治理原因"), { target: { value: "新原因" } });
    expect(screen.queryByRole("button", { name: "提交待审核" })).toBeNull();
  });
  it("主动核对和取消等待，不长轮询；取消不声称撤销治理", async () => {
    render(<ApprovalRequestPanel />);
    await preview();
    fireEvent.click(screen.getByRole("button", { name: "提交待审核" }));
    await screen.findByText(/工单 #9/);
    fireEvent.click(screen.getByRole("button", { name: "核对结果" }));
    await waitFor(() => expect(mocks.fetch).toHaveBeenCalledTimes(3));
    expect(screen.getByText(/取消等待不会撤销/)).toBeInTheDocument();
    mocks.fetch.mockResolvedValueOnce(envelope({ ...saved, state: "cancelled", case_status: "pending", executed: false, expires_at: null }));
    fireEvent.click(screen.getByRole("button", { name: "取消等待" }));
    await screen.findByText("已取消等待");
    expect(String(mocks.fetch.mock.calls.at(-1)?.[0])).toContain("/cancel");
  });

  it("提交响应失败后重试复用同一申请ID", async () => {
    render(<ApprovalRequestPanel />);
    await preview();
    mocks.fetch.mockResolvedValueOnce(Response.json({ code: 503, data: null, message: "暂不可用" }, { status: 503 }));
    fireEvent.click(screen.getByRole("button", { name: "提交待审核" }));
    await screen.findByRole("alert");
    fireEvent.click(screen.getByRole("button", { name: "提交待审核" }));
    await screen.findByText(/工单 #9/);
    expect(JSON.parse(mocks.fetch.mock.calls[1][1].body).request_id).toBe(JSON.parse(mocks.fetch.mock.calls[2][1].body).request_id);
  });

  it("恢复仅消费已执行反馈，并显示后端结果", async () => {
    render(<ApprovalRequestPanel />);
    await preview();
    fireEvent.click(screen.getByRole("button", { name: "提交待审核" }));
    await screen.findByText(/工单 #9/);
    mocks.fetch.mockResolvedValueOnce(envelope({ ...saved, state: "completed", case_status: "executed", executed: true,
      expires_at: null, result: { case_status: "executed", resolution: "hide", executed: true } }));
    fireEvent.click(screen.getByRole("button", { name: "恢复反馈" }));
    await screen.findByText("反馈已恢复");
    expect(screen.getByText("处置结果：隐藏")).toBeInTheDocument();
    expect(String(mocks.fetch.mock.calls.at(-1)?.[0])).toContain("/resume");
    expect(mocks.fetch.mock.calls.some(call => String(call[0]).includes("resolve"))).toBe(false);
  });

  it("换号时中止旧请求且不显示旧账号申请", async () => {
    const view = render(<ApprovalRequestPanel />);
    mocks.fetch.mockImplementationOnce(() => new Promise(() => undefined));
    fireEvent.change(screen.getByLabelText("目标编号"), { target: { value: "3" } });
    fireEvent.change(screen.getByLabelText("治理原因"), { target: { value: "原因" } });
    fireEvent.click(screen.getByRole("button", { name: "读取现状并预览" }));
    await waitFor(() => expect(mocks.fetch).toHaveBeenCalled());
    mocks.me.id = 8;
    view.rerender(<ApprovalRequestPanel />);
    expect(mocks.fetch.mock.calls[0][1].signal.aborted).toBe(true);
    expect(screen.queryByText(/工单 #9/)).toBeNull();
  });
});
