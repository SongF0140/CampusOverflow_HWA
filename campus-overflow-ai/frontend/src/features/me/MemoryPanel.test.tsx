// 个人记忆卡测试（T-14 M-01）：列表/新增/删除/清空确认/敏感拦截展示/账号切换重载。
import "@testing-library/jest-dom/vitest";

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  me: { id: 1, username: "alice", role: "student" } as { id: number; username: string; role: string },
}));

vi.mock("@/shared/stores/session-store", () => ({
  useSessionStore: (selector: (state: { me: unknown }) => unknown) =>
    selector({ me: mocks.me }),
}));

import { MemoryPanel } from "./MemoryPanel";

beforeEach(() => {
  window.localStorage.clear();
  mocks.me = { id: 1, username: "alice", role: "student" };
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("MemoryPanel 个人记忆卡", () => {
  it("新增记忆并列表展示；空态文案", async () => {
    render(<MemoryPanel />);
    expect(screen.getByText(/暂无记忆/)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("新增记忆内容"), {
      target: { value: "我偏好简洁的回答" },
    });
    fireEvent.click(screen.getByRole("button", { name: "添加" }));
    expect(await screen.findByText("我偏好简洁的回答")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "全部清空" })).toBeInTheDocument();
  });

  it("敏感内容拒绝并展示不含原文的原因（X-06）", async () => {
    render(<MemoryPanel />);
    fireEvent.change(screen.getByLabelText("新增记忆内容"), {
      target: { value: "我的 token 是 abc123" },
    });
    fireEvent.click(screen.getByRole("button", { name: "添加" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("敏感信息");
    expect(alert.textContent).not.toContain("abc123");
    expect(screen.getByText(/暂无记忆/)).toBeInTheDocument();
  });

  it("删除单条；全部清空经二次确认后清空", async () => {
    render(<MemoryPanel />);
    fireEvent.change(screen.getByLabelText("新增记忆内容"), {
      target: { value: "课程上下文：操作系统" },
    });
    fireEvent.click(screen.getByRole("button", { name: "添加" }));
    await screen.findByText("课程上下文：操作系统");

    // 删除单条
    fireEvent.click(screen.getByRole("button", { name: "删除" }));
    expect(screen.getByText(/暂无记忆/)).toBeInTheDocument();

    // 再新增两条，全部清空（二次确认）
    for (const text of ["记忆一", "记忆二"]) {
      fireEvent.change(screen.getByLabelText("新增记忆内容"), { target: { value: text } });
      fireEvent.click(screen.getByRole("button", { name: "添加" }));
    }
    fireEvent.click(screen.getByRole("button", { name: "全部清空" }));
    expect(screen.getByText("清空全部个人记忆")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "确认清空" }));
    await waitFor(() => {
      expect(screen.getByText(/暂无记忆/)).toBeInTheDocument();
    });
    expect(window.localStorage.getItem("co_memory_user_1")).toBeNull();
  });

  it("账号切换后重载对应命名空间（不串用）", () => {
    // 预置用户 1 与用户 2 各自的记忆
    window.localStorage.setItem(
      "co_memory_user_1",
      JSON.stringify([{ id: "a", content: "甲的记忆", created_at: "2026-10-24T00:00:00Z" }]),
    );
    window.localStorage.setItem(
      "co_memory_user_2",
      JSON.stringify([{ id: "b", content: "乙的记忆", created_at: "2026-10-24T00:00:00Z" }]),
    );

    const { unmount } = render(<MemoryPanel />);
    expect(screen.getByText("甲的记忆")).toBeInTheDocument();
    unmount();

    mocks.me = { id: 2, username: "bob", role: "student" };
    render(<MemoryPanel />);
    expect(screen.getByText("乙的记忆")).toBeInTheDocument();
    expect(screen.queryByText("甲的记忆")).toBeNull();
  });
});
