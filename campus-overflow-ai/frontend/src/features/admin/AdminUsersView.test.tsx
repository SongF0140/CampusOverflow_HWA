import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listUsers: vi.fn(),
  banUser: vi.fn(),
  unbanUser: vi.fn(),
}));

vi.mock("@/api/users", () => ({
  listUsers: mocks.listUsers,
  banUser: mocks.banUser,
  unbanUser: mocks.unbanUser,
}));

import type { UserMe } from "@/shared/types/auth";

import { AdminUsersView } from "./AdminUsersView";

function buildUser(overrides: Partial<UserMe>): UserMe {
  return {
    id: 1,
    username: "用户",
    email: "user@campus.edu",
    role: "student",
    status: "active",
    ban_reason: null,
    identity_type: "undergraduate",
    assistant_cert_status: "none",
    reputation_score: 0,
    bio: null,
    avatar_url: null,
    created_at: "2026-09-01T10:00:00+08:00",
    ...overrides,
  };
}

const USERS: UserMe[] = [
  buildUser({ id: 7, username: "小明", reputation_score: 36 }),
  buildUser({
    id: 8,
    username: "王老师",
    role: "teacher",
    reputation_score: 120,
    created_at: "2026-08-15T09:00:00+08:00",
  }),
  buildUser({
    id: 9,
    username: "闹事者",
    status: "banned",
    ban_reason: "恶意行为（时长：7 天）",
    reputation_score: 3,
  }),
];

const PAGE_PAYLOAD = { items: USERS, total: USERS.length, page: 1, page_size: 10 };

// 仓库测试不引 jest-dom matchers：禁用态/取值用原生属性断言
function getDialog(): HTMLElement {
  return screen.getByRole("dialog");
}

describe("AdminUsersView", () => {
  beforeEach(() => {
    mocks.listUsers.mockResolvedValue(PAGE_PAYLOAD);
    mocks.banUser.mockResolvedValue({ ...USERS[0] });
    mocks.unbanUser.mockResolvedValue({ ...USERS[2], status: "active", ban_reason: null });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("用户表渲染：角色中文文本徽标、状态徽标、封禁原因小字与注册时间", async () => {
    render(<AdminUsersView />);

    expect(await screen.findByText("小明")).toBeTruthy();
    expect(mocks.listUsers).toHaveBeenCalledWith({ page: 1, page_size: 10 });

    const table = screen.getByRole("table");
    // 角色列中文徽标：每个用户行出现 2 次（UserLine 内徽标 + 角色列徽标）
    expect(within(table).getAllByText("学生").length).toBe(4);
    expect(within(table).getAllByText("教师").length).toBe(2);
    // 状态徽标：正常×2 + 已封禁×1
    expect(within(table).getAllByText("正常").length).toBe(2);
    expect(within(table).getAllByText("已封禁").length).toBe(1);
    // 封禁行展示 ban_reason 小字
    expect(within(table).getByText("恶意行为（时长：7 天）")).toBeTruthy();
    // 声望与注册时间（ISO 串截取日期部分）
    expect(table.textContent).toContain("36");
    expect(table.textContent).toContain("2026-08-15");

    // 操作列条件渲染：正常行 [封禁]，封禁行 [解禁]
    expect(within(table).getAllByRole("button", { name: "封禁" }).length).toBe(2);
    expect(within(table).getAllByRole("button", { name: "解禁" }).length).toBe(1);
  });

  it("本地筛选：昵称搜索命中与未命中（含按用户 ID 检索）", async () => {
    render(<AdminUsersView />);
    await screen.findByText("小明");

    // 命中：仅保留小明行
    fireEvent.change(screen.getByLabelText("搜索用户"), { target: { value: "小明" } });
    expect(screen.getByText("小明")).toBeTruthy();
    expect(screen.queryByText("王老师")).toBeNull();

    // 按用户 ID 检索
    fireEvent.change(screen.getByLabelText("搜索用户"), { target: { value: "8" } });
    expect(await screen.findByText("王老师")).toBeTruthy();
    expect(screen.queryByText("小明")).toBeNull();

    // 未命中：空态提示
    fireEvent.change(screen.getByLabelText("搜索用户"), { target: { value: "不存在的人" } });
    expect(await screen.findByText("未找到匹配用户")).toBeTruthy();
  });

  it("角色与状态 Select 对当前页数据本地过滤", async () => {
    render(<AdminUsersView />);
    await screen.findByText("小明");

    fireEvent.change(screen.getByLabelText("角色"), { target: { value: "teacher" } });
    expect(screen.queryByText("小明")).toBeNull();
    expect(screen.getByText("王老师")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("角色"), { target: { value: "all" } });
    fireEvent.change(screen.getByLabelText("状态"), { target: { value: "banned" } });
    expect(screen.queryByText("王老师")).toBeNull();
    expect(screen.getByText("闹事者")).toBeTruthy();
  });

  it("封禁 Drawer：原因必填拦截 → 填写提交载荷拼接 → 成功 Toast 并刷新列表", async () => {
    render(<AdminUsersView />);
    await screen.findByText("小明");

    fireEvent.click(within(screen.getByRole("table")).getAllByRole("button", { name: "封禁" })[0]);
    expect(getDialog().getAttribute("aria-label")).toBe("封禁用户 · 小明");

    // 原因必填：空提交被行内拦截，不发请求
    fireEvent.click(screen.getByRole("button", { name: "确认封禁" }));
    expect(screen.getByText("请选择封禁原因")).toBeTruthy();
    expect(mocks.banUser).not.toHaveBeenCalled();

    // 填写原因/说明/时长后提交
    fireEvent.change(screen.getByLabelText("封禁原因"), { target: { value: "违规发帖" } });
    fireEvent.change(screen.getByLabelText("补充说明"), { target: { value: "刷屏灌水" } });
    fireEvent.change(screen.getByLabelText("封禁时长"), { target: { value: "永久" } });
    fireEvent.click(screen.getByRole("button", { name: "确认封禁" }));

    // TODO(接口差异) 载荷拼接：`${原因}（${说明}；时长：${时长}）`
    await waitFor(() => {
      expect(mocks.banUser).toHaveBeenCalledWith(7, "违规发帖（刷屏灌水；时长：永久）");
    });
    expect(await screen.findByText("已封禁该用户")).toBeTruthy();
    // Drawer 关闭 + 列表刷新（reloadToken 递增触发第二次 listUsers）
    expect(screen.queryByRole("dialog")).toBeNull();
    await waitFor(() => {
      expect(mocks.listUsers.mock.calls.length).toBeGreaterThanOrEqual(2);
    });
  });

  it("封禁失败：保留 Drawer 与已填内容，Toast 提示错误", async () => {
    mocks.banUser.mockRejectedValue(new Error("该用户已被封禁"));
    render(<AdminUsersView />);
    await screen.findByText("小明");

    fireEvent.click(within(screen.getByRole("table")).getAllByRole("button", { name: "封禁" })[0]);
    fireEvent.change(screen.getByLabelText("封禁原因"), { target: { value: "恶意行为" } });
    fireEvent.click(screen.getByRole("button", { name: "确认封禁" }));

    expect(await screen.findByText("该用户已被封禁")).toBeTruthy();
    expect(getDialog().getAttribute("aria-label")).toBe("封禁用户 · 小明");
  });

  it("解禁：ConfirmDialog 确认后调用 unbanUser，成功 Toast 并刷新列表", async () => {
    render(<AdminUsersView />);
    await screen.findByText("闹事者");

    fireEvent.click(within(screen.getByRole("table")).getByRole("button", { name: "解禁" }));
    expect(screen.getByText("解禁将立即生效并通知用户")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "确认" }));
    await waitFor(() => {
      expect(mocks.unbanUser).toHaveBeenCalledWith(9);
    });
    expect(await screen.findByText("已解禁并通知用户")).toBeTruthy();
    await waitFor(() => {
      expect(mocks.listUsers.mock.calls.length).toBeGreaterThanOrEqual(2);
    });
  });

  it("加载态渲染表格骨架屏", async () => {
    mocks.listUsers.mockReturnValue(new Promise(() => {}));
    render(<AdminUsersView />);

    expect(await screen.findByText("正在加载内容")).toBeTruthy();
    expect(screen.queryByText("小明")).toBeNull();
  });

  it("错误态展示中文提示并可重试", async () => {
    mocks.listUsers.mockRejectedValue(new Error("服务暂时不可用"));
    render(<AdminUsersView />);

    expect(await screen.findByText("服务暂时不可用")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "重新加载" }));
    await waitFor(() => {
      expect(mocks.listUsers).toHaveBeenCalledTimes(2);
    });
  });

  it("列表为空时渲染空态", async () => {
    mocks.listUsers.mockResolvedValue({ items: [], total: 0, page: 1, page_size: 10 });
    render(<AdminUsersView />);

    expect(await screen.findByText("暂无用户")).toBeTruthy();
  });
});
