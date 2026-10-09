import { describe, expect, it } from "vitest";

import { createRunContext } from "../src/observability/run-context";
import { InMemoryRunRecorder } from "../src/observability/run-recorder";
import { buildSummary, redactSensitive } from "../src/observability/sensitive";
import { asAgentRunId, asTraceId } from "../src/types";

describe("run context", () => {
  it("generates unique agent_run_id per run", () => {
    const a = createRunContext({ taskType: "suggest_tags" });
    const b = createRunContext({ taskType: "suggest_tags" });
    expect(a.agentRunId).not.toBe(b.agentRunId);
    expect(a.traceId).toBeTruthy();
  });

  it("passes through upstream trace id", () => {
    const ctx = createRunContext({ taskType: "doc_draft", traceId: "  trace-upstream-1  " });
    expect(ctx.traceId).toBe("trace-upstream-1");
  });

  it("falls back to generated trace id when absent", () => {
    const ctx = createRunContext({ taskType: "similar_questions" });
    expect(ctx.traceId).not.toBe("");
    expect(ctx.traceId).not.toBe(ctx.agentRunId);
  });
});

describe("sensitive filtering", () => {
  it("masks key-value style secrets", () => {
    const masked = redactSensitive("登录失败 password=abc123, token: eyJhbGciOi.abc");
    expect(masked).not.toContain("abc123");
    expect(masked).not.toContain("eyJhbGciOi.abc");
    expect(masked).toContain("password=[REDACTED]");
  });

  it("masks private key blocks", () => {
    const masked = redactSensitive("-----BEGIN RSA PRIVATE KEY-----\nMIIEow\n-----END RSA PRIVATE KEY-----");
    expect(masked).toBe("[REDACTED_PRIVATE_KEY]");
  });

  it("keeps plain text unchanged", () => {
    expect(redactSensitive("如何理解线程安全？")).toBe("如何理解线程安全？");
  });

  it("buildSummary truncates and redacts", () => {
    const summary = buildSummary(`api_key=sk-very-secret ${"x".repeat(500)}`);
    expect(summary.length).toBeLessThanOrEqual(200);
    expect(summary).not.toContain("sk-very-secret");
  });
});

describe("in-memory run recorder", () => {
  it("records run lifecycle and tool calls with redaction", () => {
    const recorder = new InMemoryRunRecorder();
    const runId = asAgentRunId("run-1");
    const traceId = asTraceId("trace-1");

    recorder.recordRun({
      agentRunId: runId,
      traceId,
      taskType: "suggest_tags",
      inputSummary: "标题: foo password=bar",
      startedAt: "2026-10-06T00:00:00.000Z",
    });
    expect(recorder.getRun(runId)?.status).toBe("running");
    expect(recorder.getRun(runId)?.inputSummary).not.toContain("bar");

    recorder.recordToolCall({
      agentRunId: runId,
      traceId,
      toolName: "searchQuestions",
      argsSummary: "keyword=payload token=secret-value",
      resultSummary: "共 3 条",
      status: "succeeded",
      durationMs: 12,
      startedAt: "2026-10-06T00:00:01.000Z",
    });
    const calls = recorder.listToolCalls(runId);
    expect(calls).toHaveLength(1);
    expect(calls[0].argsSummary).toContain("token=[REDACTED]");

    recorder.finishRun(runId, { status: "succeeded", outputSummary: "推荐 3 个标签" });
    const run = recorder.getRun(runId);
    expect(run?.status).toBe("succeeded");
    expect(run?.finishedAt).not.toBeNull();

    expect(recorder.listRunsByTraceId(traceId)).toHaveLength(1);
    expect(recorder.listRunsByTraceId(asTraceId("trace-other"))).toHaveLength(0);
  });

  it("finishRun ignores unknown run id", () => {
    const recorder = new InMemoryRunRecorder();
    expect(() =>
      recorder.finishRun(asAgentRunId("missing"), { status: "failed", errorSummary: "x" }),
    ).not.toThrow();
  });
});
