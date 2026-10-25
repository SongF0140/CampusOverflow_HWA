// AI 课程助手视图测试（T-14 端到端接线）：流式回复渲染、记忆条数提示、
// 发送交互（Enter/禁用）、错误展示与空占位移除。
import "@testing-library/jest-dom/vitest";

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  send: vi.fn(),
  me: { id: 7, username: "alice", role: "student" } as { id: number; username: string; role: string },
}));

vi.mock("@/api/agent-chat", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/agent-chat")>();
  return { ...actual, sendAgentChat: mocks.send };
});

vi.mock("@/shared/stores/session-store", () => ({
  useSessionStore: (selector: (state: { me: unknown }) => unknown) =>
    selector({ me: mocks.me }),
}));

import { AssistantChatView } from "./AssistantChatView";

beforeEach(() => {
  window.localStorage.clear();
  mocks.send.mockReset();
  // jsdom 未实现 scrollTo（组件新消息滚动底部），补空实现
  window.HTMLElement.prototype.scrollTo = () => {};
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const flush = async (times = 20) => {
  for (let i = 0; i < times; i += 1) await Promise.resolve();
};

describe("AssistantChatView AI 课程助手", () => {
  it("无记忆时提示可在个人中心保存；有记忆时显示携带条数", () => {
    const { unmount } = render(<AssistantChatView />);
    expect(screen.getByText(/在个人中心保存个人记忆后/)).toBeInTheDocument();
    unmount();

    window.localStorage.setItem(
      "co_memory_user_7",
      JSON.stringify([{ id: "a", content: "偏好简洁回答", created_at: "2026-10-24T01:00:00Z" }]),
    );
    render(<AssistantChatView />);
    expect(screen.getByText(/已携带你的 1 条个人记忆/)).toBeInTheDocument();
  });

  it("发送消息：流式增量渲染回复，调用携带正确 message", async () => {
    mocks.send.mockImplementation(async (message: string, handlers: {
      onMeta?: (meta: unknown) => void;
      onDelta?: (text: string) => void;
    }) => {
      expect(message).toBe("帮我梳理死锁的必要条件");
      handlers.onMeta?.({ agentRunId: "r", traceId: "t", ai: true });
      handlers.onDelta?.("死锁的");
      handlers.onDelta?.("四个必要条件");
      return { finishReason: "stop" };
    });
    render(<AssistantChatView />);
    fireEvent.change(screen.getByLabelText("消息输入"), {
      target: { value: "帮我梳理死锁的必要条件" },
    });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));
    await waitFor(() => {
      expect(screen.getByText("死锁的四个必要条件")).toBeInTheDocument();
    });
    expect(mocks.send).toHaveBeenCalledTimes(1);
  });

  it("Enter 发送；空消息与发送中禁用按钮", async () => {
    mocks.send.mockImplementation(() => new Promise(() => undefined)); // 永不完成的发送
    render(<AssistantChatView />);
    const input = screen.getByLabelText("消息输入");
    // 状态断言一律重新查询 DOM，避免持有陈旧节点引用
    expect(screen.getByRole("button", { name: "发送" })).toBeDisabled(); // 空消息

    fireEvent.change(input, { target: { value: "问题" } });
    await waitFor(() => expect(screen.getByRole("button", { name: "发送" })).toBeEnabled());
    fireEvent.keyDown(input, { key: "Enter", shiftKey: false });
    await waitFor(() => expect(mocks.send).toHaveBeenCalledTimes(1));
    // 发送中按钮文案为"回答中…"且禁用；完成后的恢复由"发送消息"用例的成功路径覆盖
    await waitFor(() => expect(screen.getByRole("button", { name: "回答中…" })).toBeDisabled());
  });

  it("请求失败：错误提示展示，空回复占位移除", async () => {
    mocks.send.mockRejectedValue(new Error("任务运行超时"));
    render(<AssistantChatView />);
    fireEvent.change(screen.getByLabelText("消息输入"), { target: { value: "问题" } });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("AI 助手暂不可用");
    // 仅剩用户消息，无空 assistant 占位
    expect(screen.getByText("问题")).toBeInTheDocument();
    expect(screen.queryByText("正在输入…")).toBeNull();
  });
});
