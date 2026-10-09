// 运行上下文：每次 Agent 运行生成唯一 agent_run_id，trace id 支持上游透传（宪法 C-08）
import { randomUUID } from "node:crypto";

import { asAgentRunId, asTraceId, type AgentRunId, type TaskType, type TraceId } from "../types/index.js";

/** 运行类别：四类结构化任务或演示用流式对话 */
export type RunTaskKind = TaskType | "chat";

export interface RunContext {
  agentRunId: AgentRunId;
  traceId: TraceId;
  taskType: RunTaskKind;
  startedAt: string;
}

export interface CreateRunContextOptions {
  taskType: RunTaskKind;
  /** 上游（前端 BFF / 后端）携带的 trace id；缺省时生成新值 */
  traceId?: string;
}

export const createRunContext = (options: CreateRunContextOptions): RunContext => {
  const incoming = options.traceId?.trim();
  return {
    agentRunId: asAgentRunId(randomUUID()),
    traceId: asTraceId(incoming ? incoming : randomUUID()),
    taskType: options.taskType,
    startedAt: new Date().toISOString(),
  };
};
