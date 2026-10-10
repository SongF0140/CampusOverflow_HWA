// 路由层测试：注入 mock 模型与 mock 内部客户端，验证统一响应、trace 透传与 SSE 演示
import { describe, expect, it } from "vitest";
import { MockLanguageModelV4, simulateReadableStream } from "ai/test";

import { createApp } from "../src/app";
import { runRecorder } from "../src/observability/run-recorder";
import { asTraceId } from "../src/types";

const zeroUsage = {
  inputTokens: { total: 0, noCache: 0, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 0, text: 0, reasoning: 0 },
};

/** tasks 端点走 generateObject（doGenerate），chat 走 streamText（doStream）：mock 需同时支持 */
const streamingModel = () =>
  new MockLanguageModelV4({
    doStream: {
      stream: simulateReadableStream({
        chunks: [
          { type: "stream-start", warnings: [] },
          { type: "text-start", id: "t1" },
          { type: "text-delta", id: "t1", delta: "你好，这是" },
          { type: "text-delta", id: "t1", delta: "AI 建议回答" },
          { type: "text-end", id: "t1" },
          // V4 规范：finishReason 必须是 { unified, raw } 对象
          { type: "finish", finishReason: { unified: "stop", raw: undefined }, usage: zeroUsage },
        ],
      }),
    },
    doGenerate: {
      content: [
        {
          type: "text",
          text: JSON.stringify({ tags: [{ name: "操作系统", reason: "进程调度主题", confidence: 0.9 }] }),
        },
      ],
      finishReason: { unified: "stop", raw: undefined },
      usage: zeroUsage,
      warnings: [],
    },
  });

describe("POST /agent/tasks/:type", () => {
  it("returns unified envelope and records run with passthrough trace id", async () => {
    const app = createApp({ getModel: () => streamingModel() });
    const res = await app.request("/agent/tasks/suggest_tags", {
      method: "POST",
      headers: { "x-trace-id": "trace-app-1" },
      body: JSON.stringify({ questionTitle: "如何理解死锁", questionBody: "操作系统课程问题" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { code: number; data: unknown; message: string };
    expect(body.code).toBe(200);
    expect(body.message).toBe("ok");
    expect(body.data).toMatchObject({ tags: expect.any(Array) });

    // 全链路 trace 透传（C-08）：运行记录携带请求头的 trace id
    const runs = runRecorder.listRunsByTraceId(asTraceId("trace-app-1"));
    expect(runs).toHaveLength(1);
    expect(runs[0].status).toBe("succeeded");
    expect(runs[0].agentRunId).toBeTruthy();
  });

  it("rejects unsupported task type with 400", async () => {
    const app = createApp({ getModel: () => streamingModel() });
    const res = await app.request("/agent/tasks/not_a_task", { method: "POST", body: "{}" });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: number; message: string };
    expect(body.code).toBe(400);
    expect(body.message).toBe("不支持的任务类型");
  });

  it("rejects invalid task input with 400 and failed run record", async () => {
    const app = createApp({ getModel: () => streamingModel() });
    const res = await app.request("/agent/tasks/moderation_scan", {
      method: "POST",
      body: JSON.stringify({ targetType: "answer" }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: number; message: string };
    expect(body.code).toBe(400);
  });
});

describe("POST /agent/chat (SSE demo)", () => {
  it("streams meta, delta and done events with agent_run_id", async () => {
    const app = createApp({ getModel: () => streamingModel() });
    const res = await app.request("/agent/chat", {
      method: "POST",
      headers: { "x-trace-id": "trace-chat-1" },
      body: JSON.stringify({ message: "帮我复习一下死锁的四个必要条件" }),
    });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("event: meta");
    expect(text).toContain("event: delta");
    expect(text).toContain("AI 建议回答");
    expect(text).toContain("event: done");

    const runs = runRecorder.listRunsByTraceId(asTraceId("trace-chat-1"));
    expect(runs).toHaveLength(1);
    expect(runs[0].taskType).toBe("chat");
  });

  it("emits error event when model is not configured", async () => {
    const previous = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    try {
      const app = createApp();
      const res = await app.request("/agent/chat", {
        method: "POST",
        body: JSON.stringify({ message: "hello" }),
      });
      const text = await res.text();
      expect(text).toContain("event: error");
      expect(text).toContain("模型未配置");
    } finally {
      if (previous !== undefined) {
        process.env.OPENAI_API_KEY = previous;
      }
    }
  });
});
