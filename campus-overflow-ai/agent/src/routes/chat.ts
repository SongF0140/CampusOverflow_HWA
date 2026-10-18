import { isStepCount, streamText, type LanguageModel } from "ai";
import { streamSSE } from "hono/streaming";
import { z } from "zod";

import { runRecorder } from "../observability/run-recorder.js";
import { ensureBuiltinTools } from "../tools/index.js";
import { createToolRegistry } from "../tools/registry.js";
import { beginRun, resolveModel, toErrorResponse, type AgentApp, type AppDependencies } from "./support.js";

const CHAT_SYSTEM = `你是 CampusOverflow AI 的课程学习助手。回答面向高校课程场景，内容仅作为 AI 建议供参考，不自动作为正式内容发布；需要站内数据时使用已注册工具检索。`;
const CHAT_REQUEST_SCHEMA = z.object({ message: z.string().min(1).max(2000) });
const sseData = (payload: Record<string, unknown>): string => JSON.stringify(payload);

export const registerChatRoute = (app: AgentApp, deps: AppDependencies): void => {
  app.post("/agent/chat", (c) => streamSSE(c, async (stream) => {
    const parsed = CHAT_REQUEST_SCHEMA.safeParse(await c.req.json().catch(() => undefined));
    if (!parsed.success) {
      await stream.writeSSE({ event: "error", data: sseData({ message: "请求体需为 { message: 非空文本 }" }) });
      return;
    }
    let model: LanguageModel;
    try {
      model = resolveModel(deps);
    } catch (error) {
      await stream.writeSSE({ event: "error", data: sseData({ message: toErrorResponse(error).message }) });
      return;
    }
    const runContext = beginRun(c, "chat", parsed.data.message);
    const tools = createToolRegistry();
    ensureBuiltinTools(c.get("internalClient"), tools);
    await stream.writeSSE({
      event: "meta", data: sseData({ agentRunId: runContext.agentRunId, traceId: runContext.traceId, ai: true }),
    });
    try {
      const result = streamText({
        model, system: CHAT_SYSTEM, prompt: parsed.data.message,
        tools: tools.toSdkTools(runContext), stopWhen: isStepCount(deps.maxSteps ?? 3),
      });
      for await (const delta of result.textStream) {
        await stream.writeSSE({ event: "delta", data: sseData({ text: delta }) });
      }
      const finishReason = await result.finishReason;
      runRecorder.finishRun(runContext.agentRunId, { status: "succeeded", outputSummary: "流式对话完成" });
      await stream.writeSSE({
        event: "done", data: sseData({ agentRunId: runContext.agentRunId, traceId: runContext.traceId, finishReason }),
      });
    } catch (error) {
      runRecorder.finishRun(runContext.agentRunId, { status: "failed", errorSummary: toErrorResponse(error).message });
      await stream.writeSSE({ event: "error", data: sseData({ message: "生成失败，请重试", traceId: runContext.traceId }) });
    }
  }));
};
