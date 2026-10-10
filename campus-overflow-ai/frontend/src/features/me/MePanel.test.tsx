import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  updateMe: vi.fn(),
  getMyReputation: vi.fn(),
  loadMe: vi.fn(),
  // session-store 以可变对象模拟，按用例切换登录态
  session: {
    status: "authed",
    me: null as unknown,
    loadMe: null as unknown,
  },
}));

vi.mock("@/api/users", () => ({
  updateMe: mocks.updateMe,
}));

vi.mock("@/api/reputation", () => ({
  getMyReputation: mocks.getMyReputation,
}));

vi.mock("@/shared/stores/session-store", () => ({
  useSessionStore: (selector: (state: typeof mocks.session) => unknown) =>
    selector(mocks.session),
}));

import type { UserMe } from "@/shared/types/auth";

import { MePanel } from "./MePanel";

const MOCK_ME: UserMe = {
  id: 7,
  username: "小明",
  email: "ming@campus.edu",
  role: "student",
  status: "active",
  ban_reason: null,
  identity_type: "postgraduate",
  assistant_cert_status: "approved",
  reputation_score: 36,
  bio: "操作系统在读",
  avatar_url: null,
  created_at: "2026-09-01T10:00:00+08:00",
};

const REPUTATION_PAYLOAD = {
  score: 36,
  logs: [
    {
      delta: 5,
      reason: "回答被采纳",
      ref_type: "answer",
      ref_id: 12,
      created_at: "2026-10-05T10:00:00+08:00",
    },
  ],
  total: 1,
  page: 1,
  page_size: 10,
};

describe("MePanel", () => {
  beforeEach(() => {
    mocks.updateMe.mockResolvedValue({ ...MOCK_ME });
    mocks.getMyReputation.mockResolvedValue(REPUTATION_PAYLOAD);
    mocks.loadMe.mockResolvedValue(undefined);
    mocks.session.status = "authed";
    mocks.session.me = { ...MOCK_ME };
    mocks.session.loadMe = mocks.loadMe;
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("登录态渲染资料卡：预填昵称与简介，声望流水展示当前声望", async () => {
    render(<MePanel />);

    const nicknameInput = (await screen.findByLabelText("昵称")) as HTMLInputElement;
    expect(nicknameInput.value).toBe("小明");
    expect((screen.getByLabelText("简介") as HTMLTextAreaElement).value).toBe("操作系统在读");
    expect(await screen.findByText("当前声望")).toBeTruthy();
    // 36 同时出现在声望摘要与首行余额列，断言存在即可
    expect(screen.getAllByText("36").length).toBeGreaterThanOrEqual(1);
  });

  it("快捷入口条件渲染：通知中心恒有，AI 记忆置灰带 tooltip，申诉入口非封禁不显示", async () => {
    render(<MePanel />);

    await screen.findByLabelText("昵称");
    expect(screen.getByText("通知中心")).toBeTruthy();

    const memoryEntry = screen.getByRole("button", { name: /我的 AI 记忆/ });
    expect((memoryEntry as HTMLButtonElement).disabled).toBe(true);
    expect(memoryEntry.title).toBe("随 AI 功能开放");

    expect(screen.queryByText("封禁申诉")).toBeNull();
  });

  it("封禁态用户显示封禁申诉入口", async () => {
    mocks.session.me = { ...MOCK_ME, status: "banned" };
    render(<MePanel />);

    expect(await screen.findByText("封禁申诉")).toBeTruthy();
  });

  it("空昵称行内拦截：提示错误且不发 PATCH", async () => {
    render(<MePanel />);

    const nicknameInput = await screen.findByLabelText("昵称");
    fireEvent.change(nicknameInput, { target: { value: "  " } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    expect(await screen.findByText("昵称不能为空")).toBeTruthy();
    expect(mocks.updateMe).not.toHaveBeenCalled();
  });

  it("保存成功：PATCH 携带变更后的昵称与简介，并同步登录态（loadMe）+ 成功 Toast", async () => {
    mocks.updateMe.mockResolvedValue({ ...MOCK_ME, username: "新昵称" });
    mocks.loadMe.mockImplementation(async () => {
      mocks.session.me = { ...MOCK_ME, username: "新昵称" };
    });
    const { rerender } = render(<MePanel />);

    fireEvent.change(await screen.findByLabelText("昵称"), {
      target: { value: "  新昵称  " },
    });
    fireEvent.change(screen.getByLabelText("简介"), {
      target: { value: "分布式系统在读" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => {
      expect(mocks.updateMe).toHaveBeenCalledWith({
        username: "新昵称",
        bio: "分布式系统在读",
      });
    });
    await waitFor(() => {
      expect(mocks.loadMe).toHaveBeenCalled();
    });
    expect(await screen.findByText("资料已保存")).toBeTruthy();
    rerender(<MePanel />);
    expect((screen.getByLabelText("昵称") as HTMLInputElement).value.trim()).toBe("新昵称");
    expect(mocks.session.me).toMatchObject({ username: "新昵称" });
  });

  it("guest 态兜底登录引导，不渲染资料卡", async () => {
    mocks.session.status = "guest";
    render(<MePanel />);

    expect(await screen.findByText("登录后查看个人中心")).toBeTruthy();
    expect(screen.queryByLabelText("昵称")).toBeNull();
  });

  it("加载中渲染骨架屏", async () => {
    mocks.session.status = "loading";
    mocks.session.me = null;
    render(<MePanel />);

    expect(await screen.findByText("正在加载个人中心")).toBeTruthy();
    expect(screen.queryByLabelText("昵称")).toBeNull();
  });
});
