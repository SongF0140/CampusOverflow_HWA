// Hono 应用定义：与 server.ts 分离，便于测试直接导入
import { streamSSE } from "hono/streaming";
import { isStepCount, streamText, type LanguageModel } from "ai";
import { Hono } from "hono";
import { z } from "zod";

import { createLanguageModel, ModelNotConfiguredError } from "./config.js";
import { defaultInternalClient, type InternalClient } from "./internal-client.js";
import { SelfCheckError } from "./loop/self-check.js";
import { createRunContext } from "./observability/run-context.js";
import { runRecorder } from "./observability/run-recorder.js";
import { TaskRouterError, dispatchTask } from "./tasks/index.js";
import { TaskTypeSchema } from "./types/index.js";
import { ensureBuiltinTools } from "./tools/index.js";
import { toSdkTools } from "./tools/registry.js";

// 统一响应格式：{ code, data, message }（见 .trae/rules/project-context.md API 约定）
export const healthPayload = () => ({
  code: 200,
  data: { status: "up", service: "agent" },
  message: "ok",
});

/** 演示用对话系统提示：输出必须带 AI 建议属性说明 */
const CHAT_SYSTEM = `你是 CampusOverflow AI 的课程学习助手。回答面向高校课程场景，内容仅作为 AI 建议供参考，不自动作为正式内容发布；需要站内数据时使用已注册工具检索。`;

const CHAT_REQUEST_SCHEMA = z.object({ message: z.string().min(1).max(2000) });

export interface AppDependencies {
  /** 注入语言模型（测试用 mock）；缺省时从环境变量解析 */
  getModel?: () => LanguageModel;
  /** 注入内部接口客户端（测试用 mock）；缺省时读环境变量 */
  internalClient?: InternalClient;
  /** 注入步数上限（测试用）；缺省 3 */
  maxSteps?: number;
}

const resolveModel = (deps: AppDependencies): LanguageModel => deps.getModel?.() ?? createLanguageModel();

// status 收敛为字面量联合：Hono 的 c.json 第二参要求字面量状态码
const toErrorResponse = (error: unknown): { status: 400 | 500; message: string } => {
  if (error instanceof z.ZodError) {
    return { status: 400, message: error.issues[0]?.message ?? "参数校验失败" };
  }
  if (error instanceof TaskRouterError) {
    return { status: 400, message: error.message };
  }
  if (error instanceof ModelNotConfiguredError) {
    return { status: 500, message: error.message };
  }
  if (error instanceof SelfCheckError) {
    // 自检失败不得把未通过校验的输出返回给用户（agent端需求文档 §3.1）
    return { status: 500, message: "生成结果未通过自检，请重试" };
  }
  return { status: 500, message: "Agent 处理失败，请稍后重试" };
};

const sseData = (payload: Record<string, unknown>): string => JSON.stringify(payload);

export const createApp = (deps: AppDependencies = {}): Hono => {
  const app = new Hono();

  // /health 供运维探针；/agent/health 供前端 rewrites 代理（/api/agent/health）
  app.get("/health", (c) => c.json(healthPayload()));
  app.get("/agent/health", (c) => c.json(healthPayload()));

  ensureBuiltinTools(deps.internalClient ?? defaultInternalClient());

  // 演示用 SSE 流式对话：每次运行有唯一 agent_run_id，工具调用走白名单注册表
  app.post("/agent/chat", (c) => {
    return streamSSE(c, async (stream) => {
      const rawBody: unknown = await c.req.json().catch(() => undefined);
      const parsed = CHAT_REQUEST_SCHEMA.safeParse(rawBody);
      if (!parsed.success) {
        await stream.writeSSE({ event: "error", data: sseData({ message: "请求体需为 { message: 非空文本 }" }) });
        return;
      }
      let model: LanguageModel;
      try {
        model = resolveModel(deps);
      } catch (error) {
        await stream.writeSSE({
          event: "error",
          data: sseData({ message: error instanceof Error ? error.message : "模型未配置" }),
        });
        return;
      }
      const runContext = createRunContext({ taskType: "chat", traceId: c.req.header("x-trace-id") });
      runRecorder.recordRun({
        agentRunId: runContext.agentRunId,
        traceId: runContext.traceId,
        taskType: runContext.taskType,
        inputSummary: parsed.data.message,
        startedAt: runContext.startedAt,
      });
      await stream.writeSSE({
        event: "meta",
        data: sseData({ agentRunId: runContext.agentRunId, traceId: runContext.traceId, ai: true }),
      });
      try {
        const result = streamText({
          model,
          system: CHAT_SYSTEM,
          prompt: parsed.data.message,
          tools: toSdkTools(runContext),
          stopWhen: isStepCount(deps.maxSteps ?? 3),
        });
        for await (const delta of result.textStream) {
          await stream.writeSSE({ event: "delta", data: sseData({ text: delta }) });
        }
        const finishReason = await result.finishReason;
        runRecorder.finishRun(runContext.agentRunId, { status: "succeeded", outputSummary: "流式对话完成" });
        await stream.writeSSE({
          event: "done",
          data: sseData({ agentRunId: runContext.agentRunId, traceId: runContext.traceId, finishReason }),
        });
      } catch (error) {
        runRecorder.finishRun(runContext.agentRunId, {
          status: "failed",
          errorSummary: error instanceof Error ? error.message : String(error),
        });
        await stream.writeSSE({ event: "error", data: sseData({ message: "生成失败，请重试", traceId: runContext.traceId }) });
      }
    });
  });

  // 结构化任务端点：Zod 校验入参 → task router 分发 → 自检后的结构化结果
  app.post("/agent/tasks/:type", async (c) => {
    const typeParse = TaskTypeSchema.safeParse(c.req.param("type"));
    if (!typeParse.success) {
      return c.json({ code: 400, data: null, message: "不支持的任务类型" }, 400);
    }
    let model: LanguageModel;
    try {
      model = resolveModel(deps);
    } catch (error) {
      const mapped = toErrorResponse(error);
      return c.json({ code: mapped.status, data: null, message: mapped.message }, mapped.status);
    }
    const rawBody: unknown = await c.req.json().catch(() => undefined);
    const runContext = createRunContext({ taskType: typeParse.data, traceId: c.req.header("x-trace-id") });
    runRecorder.recordRun({
      agentRunId: runContext.agentRunId,
      traceId: runContext.traceId,
      taskType: runContext.taskType,
      inputSummary: JSON.stringify(rawBody ?? {}),
      startedAt: runContext.startedAt,
    });
    try {
      const data = await dispatchTask(typeParse.data, rawBody, {
        runContext,
        model,
        internalClient: deps.internalClient,
      });
      runRecorder.finishRun(runContext.agentRunId, { status: "succeeded", outputSummary: JSON.stringify(data) });
      return c.json({ code: 200, data, message: "ok" });
    } catch (error) {
      runRecorder.finishRun(runContext.agentRunId, {
        status: "failed",
        errorSummary: error instanceof Error ? error.message : String(error),
      });
      const mapped = toErrorResponse(error);
      return c.json({ code: mapped.status, data: null, message: mapped.message }, mapped.status);
    }
  });

  return app;
};
