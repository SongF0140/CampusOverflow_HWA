// 运行摘要记录器：本期为内存实现，接口与持久化实现对齐（T-16 换 MySQL 落库，经内部接口）
// 所有摘要写入前必须经 buildSummary 脱敏（C-08：可按 trace id 检索；C-07：不落敏感原文）
import type { AgentRunId, TraceId } from "../types/index.js";
import type { RunTaskKind } from "./run-context.js";

import { buildSummary } from "./sensitive.js";

export type RunStatus = "running" | "succeeded" | "failed";

export interface RunRecord {
  agentRunId: AgentRunId;
  traceId: TraceId;
  taskType: RunTaskKind;
  status: RunStatus;
  inputSummary: string;
  outputSummary: string | null;
  errorSummary: string | null;
  startedAt: string;
  finishedAt: string | null;
}

export interface ToolCallRecord {
  agentRunId: AgentRunId;
  traceId: TraceId;
  toolName: string;
  argsSummary: string;
  resultSummary: string | null;
  status: "succeeded" | "failed";
  durationMs: number | null;
  startedAt: string;
}

export interface RunRecorder {
  recordRun(record: Omit<RunRecord, "status" | "outputSummary" | "errorSummary" | "finishedAt">): void;
  finishRun(
    agentRunId: AgentRunId,
    result: { status: "succeeded" | "failed"; outputSummary?: string; errorSummary?: string },
  ): void;
  recordToolCall(record: ToolCallRecord): void;
  getRun(agentRunId: AgentRunId): RunRecord | undefined;
  listRunsByTraceId(traceId: TraceId): RunRecord[];
}

export class InMemoryRunRecorder implements RunRecorder {
  private readonly runs = new Map<AgentRunId, RunRecord>();
  private readonly toolCalls: ToolCallRecord[] = [];

  recordRun(record: Omit<RunRecord, "status" | "outputSummary" | "errorSummary" | "finishedAt">): void {
    this.runs.set(record.agentRunId, {
      ...record,
      inputSummary: buildSummary(record.inputSummary),
      status: "running",
      outputSummary: null,
      errorSummary: null,
      finishedAt: null,
    });
  }

  finishRun(
    agentRunId: AgentRunId,
    result: { status: "succeeded" | "failed"; outputSummary?: string; errorSummary?: string },
  ): void {
    const run = this.runs.get(agentRunId);
    if (!run) {
      return;
    }
    run.status = result.status;
    run.outputSummary = result.outputSummary ? buildSummary(result.outputSummary) : null;
    run.errorSummary = result.errorSummary ? buildSummary(result.errorSummary) : null;
    run.finishedAt = new Date().toISOString();
  }

  recordToolCall(record: ToolCallRecord): void {
    this.toolCalls.push({
      ...record,
      argsSummary: buildSummary(record.argsSummary),
      resultSummary: record.resultSummary ? buildSummary(record.resultSummary) : null,
    });
  }

  getRun(agentRunId: AgentRunId): RunRecord | undefined {
    return this.runs.get(agentRunId);
  }

  listRunsByTraceId(traceId: TraceId): RunRecord[] {
    return Array.from(this.runs.values()).filter((run) => run.traceId === traceId);
  }

  /** 工具调用流水（观测查询用） */
  listToolCalls(agentRunId: AgentRunId): ToolCallRecord[] {
    return this.toolCalls.filter((call) => call.agentRunId === agentRunId);
  }
}

/** 模块级单例：T-16 持久化时替换为经内部接口写后端的实现，调用方不变 */
export const runRecorder: RunRecorder = new InMemoryRunRecorder();
