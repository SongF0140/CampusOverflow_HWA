// Agent 聊天封装测试（T-14 端到端接线）：发送前注入当前账号的浏览器记忆
// （browser_memory）、SSE 事件解析（meta/delta/done/error）、非 SSE 与中断错误。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  me: { id: 7 } as { id: number } | null,
}));

vi.mock("@/shared/stores/session-store", () => ({
  useSessionStore: {
    getState: () => ({ me: mocks.me }),
  },
}));

import { AgentChatError, sendAgentChat } from "./agent-chat";

const sse = (events: Array<[string, unknown]>): Response => new Response(
  new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      for (const [event, data] of events) {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      }
      controller.close();
    },
  }),
  { status: 200, headers: { "content-type": "text/event-stream" } },
);

const requestBody = (callIndex = -1): { message: string; browser_memory?: string[] } => {
  const call = mocks.fetch.mock.calls.at(callIndex);
  const init = call?.[1] as RequestInit | undefined;
  return JSON.parse(String(init?.body)) as { message: string; browser_memory?: string[] };
};

beforeEach(() => {
  window.localStorage.clear();
  mocks.me = { id: 7 };
  mocks.fetch.mockReset();
  vi.stubGlobal("fetch", mocks.fetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("sendAgentChat 记忆注入（T-14 接线点）", () => {
  it("当前账号有记忆时随请求携带 browser_memory（最新在前，≤20 条）", async () => {
    window.localStorage.setItem(
      "co_memory_user_7",
      JSON.stringify([
        { id: "a", content: "偏好简洁回答", created_at: "2026-10-24T01:00:00Z" },
        { id: "b", content: "备考操作系统", created_at: "2026-10-24T02:00:00Z" },
      ]),
    );
    mocks.fetch.mockResolvedValue(sse([
      ["meta", { agentRunId: "run-1", traceId: "t-1", ai: true }],
      ["delta", { text: "你好" }],
      ["done", { agentRunId: "run-1", traceId: "t-1", finishReason: "stop" }],
    ]));

    const result = await sendAgentChat("帮我复习死锁");
    expect(requestBody()).toEqual({
      message: "帮我复习死锁",
      browser_memory: ["备考操作系统", "偏好简洁回答"], // 最新在前
    });
    expect(result.finishReason).toBe("stop");
  });

  it("当前账号无记忆或未登录时省略 browser_memory 字段", async () => {
    // 每次调用生成新 Response：同一 ReadableStream 只能被读取（锁定）一次
    mocks.fetch.mockImplementation(async () => sse([["done", { finishReason: "stop" }]]));
    await sendAgentChat("问题一");
    expect(requestBody()).toEqual({ message: "问题一" });

    mocks.me = null;
    await sendAgentChat("问题二");
    expect(requestBody()).toEqual({ message: "问题二" });
  });
});

describe("sendAgentChat SSE 流解析", () => {
  it("meta 与 delta 事件按序回调", async () => {
    mocks.fetch.mockResolvedValue(sse([
      ["meta", { agentRunId: "run-2", traceId: "t-2", ai: true }],
      ["delta", { text: "死锁的" }],
      ["delta", { text: "四个必要条件" }],
      ["done", { finishReason: "stop" }],
    ]));
    const received: string[] = [];
    let meta: { agentRunId: string } | undefined;
    const result = await sendAgentChat("q", {
      onMeta: (value) => { meta = value; },
      onDelta: (text) => { received.push(text); },
    });
    expect(meta).toEqual({ agentRunId: "run-2", traceId: "t-2", ai: true });
    expect(received).toEqual(["死锁的", "四个必要条件"]);
    expect(result.finishReason).toBe("stop");
  });

  it("error 事件抛 AgentChatError（后端中文文案）", async () => {
    // 每次调用生成新 Response：同一 ReadableStream 只能被读取（锁定）一次
    mocks.fetch.mockImplementation(async () => sse([
      ["meta", { agentRunId: "r", traceId: "t", ai: true }],
      ["error", { message: "任务运行超时", traceId: "t" }],
    ]));
    await expect(sendAgentChat("q")).rejects.toThrow(AgentChatError);
    await expect(sendAgentChat("q")).rejects.toThrow("任务运行超时");
  });

  it("非 SSE 响应（如 BFF 503 信封）抛错并透传 message", async () => {
    mocks.fetch.mockResolvedValue(new Response(
      JSON.stringify({ code: 503, data: null, message: "AI 服务暂不可用，请稍后重试" }),
      { status: 503, headers: { "content-type": "application/json" } },
    ));
    await expect(sendAgentChat("q")).rejects.toThrow("AI 服务暂不可用，请稍后重试");
  });

  it("流意外结束（无 done）抛回复中断", async () => {
    mocks.fetch.mockResolvedValue(sse([["delta", { text: "半截" }]]));
    await expect(sendAgentChat("q")).rejects.toThrow("回复中断");
  });
});
