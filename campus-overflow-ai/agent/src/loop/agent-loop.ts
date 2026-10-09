// 单 Agent Loop：streamText + stopWhen 步数上限；停止条件由 AI SDK 保证——
// 仅有最后一步产生工具调用结果时才继续下一步，达到 isStepCount 上限或模型不再调用工具即停止
// 每次工具调用经 registry 白名单与风险守卫（见 tools/registry.ts 的 execute 包装）
import { isStepCount, streamText, type LanguageModel, type ToolSet } from "ai";

import type { RunContext } from "../observability/run-context.js";
import { buildSummary } from "../observability/sensitive.js";
import type { RunRecorder } from "../observability/run-recorder.js";

/** 步数上限：防死循环的硬闸（agent端需求文档 §3.1 停止条件） */
export const DEFAULT_MAX_STEPS = 3;

export interface AgentLoopOptions {
  model: LanguageModel;
  system: string;
  prompt: string;
  runContext: RunContext;
  /** 已构建的 SDK 工具集（toSdkTools 产出）；缺省为纯文本对话 */
  tools?: ToolSet;
  maxSteps?: number;
  /** 观测记录器：传入则记录每次工具调用摘要（C-08） */
  recorder?: RunRecorder;
}

export interface AgentLoopResult {
  text: string;
  finishReason: string;
  /** 已执行工具调用的脱敏摘要（按执行顺序） */
  toolCallSummaries: string[];
}

export const runAgentLoop = async (options: AgentLoopOptions): Promise<AgentLoopResult> => {
  const toolCallSummaries: string[] = [];
  const result = streamText({
    model: options.model,
    system: options.system,
    prompt: options.prompt,
    tools: options.tools,
    stopWhen: isStepCount(options.maxSteps ?? DEFAULT_MAX_STEPS),
    onToolExecutionEnd: (event) => {
      // 工具调用摘要就地记录（C-08），脱敏后入观测记录器；
      // AI SDK 7 以 toolOutput.type 判别成败：tool-result 时 output 为结果，tool-error 时为失败
      const { toolCall, toolOutput, toolExecutionMs } = event;
      const isFailed = toolOutput.type === "tool-error";
      toolCallSummaries.push(`${toolCall.toolName}(${buildSummary(JSON.stringify(toolCall.input))})`);
      if (options.recorder) {
        options.recorder.recordToolCall({
          agentRunId: options.runContext.agentRunId,
          traceId: options.runContext.traceId,
          toolName: toolCall.toolName,
          argsSummary: buildSummary(JSON.stringify(toolCall.input)),
          resultSummary:
            toolOutput.type === "tool-result" ? buildSummary(JSON.stringify(toolOutput.output ?? null)) : null,
          status: isFailed ? "failed" : "succeeded",
          durationMs: toolExecutionMs,
          startedAt: new Date().toISOString(),
        });
      }
    },
  });

  const text = await result.text;
  const finish = await result.finishReason;
  return { text, finishReason: finish, toolCallSummaries };
};
