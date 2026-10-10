// Agent Loop 测试：mock 语言模型（ai/test 的 MockLanguageModelV4），不依赖真实网络与真实后端
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { MockLanguageModelV4, simulateReadableStream } from "ai/test";

import { runAgentLoop } from "../src/loop/agent-loop";
import { createRunContext } from "../src/observability/run-context";
import { InMemoryRunRecorder } from "../src/observability/run-recorder";
import { registerTool, toSdkTools } from "../src/tools/registry";
import { asAgentRunId, asTraceId, type TraceId } from "../src/types";

const zeroUsage = {
  inputTokens: { total: 0, noCache: 0, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 0, text: 0, reasoning: 0 },
};

// V4 规范的 finishReason 是 { unified, raw } 对象；传字符串会被归一为 "other"，导致工具执行被跳过
const finishWith = (unified: "stop" | "tool-calls") => ({ unified, raw: undefined });

const textStepStream = (text: string) => ({
  stream: simulateReadableStream({
    chunks: [
      { type: "stream-start", warnings: [] },
      { type: "text-start", id: "t1" },
      { type: "text-delta", id: "t1", delta: text },
      { type: "text-end", id: "t1" },
      { type: "finish", finishReason: finishWith("stop"), usage: zeroUsage },
    ],
  }),
});

const toolCallStepStream = (toolName: string, toolCallId: string, input: object) => ({
  stream: simulateReadableStream({
    chunks: [
      { type: "stream-start", warnings: [] },
      { type: "tool-input-start", id: toolCallId, toolName },
      { type: "tool-input-end", id: toolCallId },
      { type: "tool-call", toolCallId, toolName, input: JSON.stringify(input) },
      { type: "finish", finishReason: finishWith("tool-calls"), usage: zeroUsage },
    ],
  }),
});

describe("agent loop with mock model", () => {
  it("executes whitelisted low-risk tool then answers, recording redacted summaries", async () => {
    const capturedTraceIds: TraceId[] = [];
    const executeSpy = vi.fn(async (input: unknown, context: { traceId: TraceId }) => {
      capturedTraceIds.push(context.traceId);
      const parsed = z.object({ keyword: z.string() }).parse(input);
      return [{ id: 1, title: `命中:${parsed.keyword}` }];
    });
    registerTool({
      name: "loopLookupQuestions",
      description: "测试用问题检索工具",
      riskLevel: "low",
      inputSchema: z.object({ keyword: z.string().min(1) }),
      execute: executeSpy,
    });

    const recorder = new InMemoryRunRecorder();
    const runContext = createRunContext({ taskType: "similar_questions", traceId: "trace-loop-1" });
    const model = new MockLanguageModelV4({
      doStream: [
        toolCallStepStream("loopLookupQuestions", "call-1", { keyword: "死锁" }),
        textStepStream("根据检索结果给出答案"),
      ],
    });

    const result = await runAgentLoop({
      model,
      system: "测试系统提示",
      prompt: "什么是死锁？",
      runContext,
      tools: toSdkTools(runContext),
      recorder,
    });

    expect(result.text).toBe("根据检索结果给出答案");
    expect(result.finishReason).toBe("stop");
    expect(executeSpy).toHaveBeenCalledTimes(1);
    expect(capturedTraceIds).toEqual([runContext.traceId]);

    const calls = recorder.listToolCalls(runContext.agentRunId);
    expect(calls).toHaveLength(1);
    expect(calls[0].toolName).toBe("loopLookupQuestions");
    expect(calls[0].traceId).toBe(asTraceId("trace-loop-1"));
    expect(calls[0].status).toBe("succeeded");
    expect(result.toolCallSummaries[0]).toContain("loopLookupQuestions");
  });

  it("stops at max steps when the model keeps calling tools", async () => {
    registerTool({
      name: "loopEndlessTool",
      description: "持续被调用的工具，验证步数上限",
      riskLevel: "low",
      inputSchema: z.object({ keyword: z.string() }),
      execute: async () => ["结果"],
    });
    // 每一步的 doStream 需要一个独立的流对象：单结果的 ReadableStream 被第一步消费后即耗尽
    const model = new MockLanguageModelV4({
      doStream: [
        toolCallStepStream("loopEndlessTool", "call-loop-1", { keyword: "x" }),
        toolCallStepStream("loopEndlessTool", "call-loop-2", { keyword: "x" }),
      ],
    });
    const runContext = createRunContext({ taskType: "chat" });

    const result = await runAgentLoop({
      model,
      system: "测试",
      prompt: "不停调用工具",
      runContext,
      tools: toSdkTools(runContext),
      maxSteps: 2,
    });

    // 步数上限 2：两步各执行一次工具后停止，不死循环
    expect(result.toolCallSummaries).toHaveLength(2);
  });
});
