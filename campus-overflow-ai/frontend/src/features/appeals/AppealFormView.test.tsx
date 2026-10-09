import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  apiFetch: vi.fn(),
  push: vi.fn(),
  // session-store 以可变对象模拟，按用例切换登录态与封禁态
  session: {
    status: "authed" as "loading" | "authed" | "guest",
    me: null as {
      username: string;
      role: string;
      status: string;
      ban_reason: string | null;
    } | null,
  },
}));

vi.mock("@/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/client")>();
  return { ...actual, apiFetch: mocks.apiFetch };
});

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push, replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
}));

vi.mock("@/shared/stores/session-store", () => ({
  useSessionStore: (selector: (state: typeof mocks.session) => unknown) => selector(mocks.session),
}));

import { ApiError } from "@/api/client";

import { AppealFormView } from "./AppealFormView";

const LONG_REASON = "这个封禁是误判，我当时只是正常回复了课程问题，并未违反社区规范，请求管理员复核解封。";

function setMe(me: (typeof mocks.session)["me"]): void {
  mocks.session.status = "authed";
  mocks.session.me = me;
}

describe("AppealFormView", () => {
  beforeEach(() => {
    mocks.session.status = "authed";
    mocks.session.me = null;
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("未封禁用户访问：显示 EmptyState 与返回链接，不渲染申诉表单", async () => {
    setMe({ username: "alice", role: "student", status: "active", ban_reason: null });
    render(<AppealFormView />);

    expect(await screen.findByText("你的账号状态正常，无需申诉")).toBeTruthy();
    expect(screen.getByRole("link", { name: "返回首页" }).getAttribute("href")).toBe("/");
    expect(screen.queryByLabelText("申诉理由")).toBeNull();
  });

  it("封禁态访问：回显卡显示封禁状态与原因，并渲染申诉表单", async () => {
    setMe({ username: "alice", role: "student", status: "banned", ban_reason: "违规发帖" });
    render(<AppealFormView />);

    expect(await screen.findByText("已封禁")).toBeTruthy();
    expect(screen.getByText("违规发帖")).toBeTruthy();
    expect(screen.getByLabelText("申诉理由")).toBeTruthy();
  });

  it("封禁原因缺失：回显卡显示占位文案", async () => {
    setMe({ username: "alice", role: "student", status: "banned", ban_reason: null });
    render(<AppealFormView />);

    expect(await screen.findByText("未记录封禁原因")).toBeTruthy();
  });

  it("理由不足 30 字：提交被拦截，不发起请求", async () => {
    setMe({ username: "alice", role: "student", status: "banned", ban_reason: "违规发帖" });
    render(<AppealFormView />);

    fireEvent.change(await screen.findByLabelText("申诉理由"), {
      target: { value: "我确实是误封的" },
    });
    fireEvent.click(screen.getByRole("button", { name: "提交申诉" }));

    expect(screen.getByText(/申诉理由至少 30 字/)).toBeTruthy();
    expect(mocks.apiFetch).not.toHaveBeenCalled();
  });

  it("提交失败（501 占位）：显示兜底文案且保留已输入内容", async () => {
    setMe({ username: "alice", role: "student", status: "banned", ban_reason: "违规发帖" });
    mocks.apiFetch.mockRejectedValue(new ApiError(501, "Not Implemented"));
    render(<AppealFormView />);

    fireEvent.change(await screen.findByLabelText("申诉理由"), { target: { value: LONG_REASON } });
    fireEvent.click(screen.getByRole("button", { name: "提交申诉" }));

    expect(await screen.findByText("申诉接口尚未开放，请稍后再试")).toBeTruthy();
    expect((screen.getByLabelText("申诉理由") as HTMLTextAreaElement).value).toBe(LONG_REASON);
    expect(mocks.apiFetch).toHaveBeenCalledWith(
      "/appeals",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("提交被后端驳回（400）：透传后端中文原因而非兜底文案", async () => {
    setMe({ username: "alice", role: "student", status: "banned", ban_reason: "违规发帖" });
    mocks.apiFetch.mockRejectedValue(new ApiError(400, "申诉理由包含违规内容"));
    render(<AppealFormView />);

    fireEvent.change(await screen.findByLabelText("申诉理由"), { target: { value: LONG_REASON } });
    fireEvent.click(screen.getByRole("button", { name: "提交申诉" }));

    expect(await screen.findByText("申诉理由包含违规内容")).toBeTruthy();
  });

  it("提交成功：以蛇形负载调用接口，显示已提交提示后跳转通知中心", async () => {
    setMe({ username: "alice", role: "student", status: "banned", ban_reason: "违规发帖" });
    mocks.apiFetch.mockResolvedValue({ id: 1 });
    render(<AppealFormView />);

    fireEvent.change(await screen.findByLabelText("申诉理由"), { target: { value: LONG_REASON } });
    fireEvent.click(screen.getByRole("button", { name: "提交申诉" }));

    expect(await screen.findByText("已提交，结果将在通知中告知")).toBeTruthy();
    expect(mocks.apiFetch).toHaveBeenCalledWith("/appeals", {
      method: "POST",
      body: JSON.stringify({ reason: LONG_REASON }),
    });
    // 成功后停留展示 Toast，再跳通知中心（1.5s 延迟）
    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith("/notifications"), {
      timeout: 3000,
    });
  });
});
