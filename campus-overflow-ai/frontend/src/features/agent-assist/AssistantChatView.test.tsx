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
import { clearMemoryEntries } from "@/shared/lib/browser-memory";

beforeEach(() => {
  window.localStorage.clear();
  mocks.send.mockReset();
  mocks.me.id = 7;
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
  it("点击加号创建独立会话，可以切回原会话且历史按账号保存", async () => {
    mocks.send.mockImplementation(async (_message, handlers) => { handlers.onDelta?.("原回复"); return { finishReason: "stop" }; });
    render(<AssistantChatView />);
    fireEvent.change(screen.getByLabelText("消息输入"), { target: { value: "原问题" } });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));
    await screen.findByText("原回复");
    fireEvent.click(screen.getByRole("button", { name: "＋ 新会话" }));
    expect(screen.queryByText("原回复")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "原问题" }));
    expect(screen.getByText("原回复")).toBeInTheDocument();
    expect(window.localStorage.getItem("co_chat_user_7")).toContain("原回复");
  });

  it("切换会话中止请求，旧响应不能回写新会话", async () => {
    let emit: ((text: string) => void) | undefined;
    mocks.send.mockImplementation((_message, handlers) => { emit = handlers.onDelta; return new Promise(() => undefined); });
    render(<AssistantChatView />);
    fireEvent.change(screen.getByLabelText("消息输入"), { target: { value: "旧问题" } });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));
    await waitFor(() => expect(mocks.send).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: "＋ 新会话" }));
    expect(mocks.send.mock.calls[0][2].signal.aborted).toBe(true);
    emit?.("迟到的旧回复");
    expect(screen.queryByText("迟到的旧回复")).toBeNull();
  });

  it("清空记忆或切换账号中止在途回复，不带入新账号", async () => {
    let emit: ((text: string) => void) | undefined;
    mocks.send.mockImplementation((_message, handlers) => { emit = handlers.onDelta; return new Promise(() => undefined); });
    const view = render(<AssistantChatView />);
    fireEvent.change(screen.getByLabelText("消息输入"), { target: { value: "账号七的问题" } });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));
    await waitFor(() => expect(mocks.send).toHaveBeenCalled());
    clearMemoryEntries(7);
    expect(mocks.send.mock.calls[0][2].signal.aborted).toBe(true);
    mocks.me.id = 8;
    view.rerender(<AssistantChatView />);
    emit?.("旧账号迟到回复");
    expect(screen.queryByText("旧账号迟到回复")).toBeNull();
    expect(screen.queryByText("账号七的问题", { selector: "li" })).toBeNull();
    expect(window.localStorage.getItem("co_chat_user_8")).not.toContain("账号七的问题");
  });
  it("无记忆时提示可在个人中心保存；有记忆时显示携带条数", () => {
    const { unmount } = render(<AssistantChatView />);
    expect(screen.getByText(/在个人中心保存个人记忆后/)).toBeInTheDocument();
    unmount();

    window.localStorage.setItem(
      "co_memory_user_7",
      JSON.stringify([{ id: "a", content: "偏好简洁回答", created_at: "2026-10-24T01:00:00Z" }]),
    );
    render(<AssistantChatView />);
    expect(screen.getByText(/已有你的 1 条个人记忆/)).toBeInTheDocument();
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
    expect(screen.getByText("问题", { selector: "li" })).toBeInTheDocument();
    expect(screen.queryByText("正在输入…")).toBeNull();
  });
});
