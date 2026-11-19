// P2 全量扫描执行器：分批游标、取消、单条失败隔离、单次上限与租约丢失。
import { describe, expect, it, vi } from "vitest";
import { MockLanguageModelV4 } from "ai/test";

import {
  InternalApiError,
  type PatrolContentItem, type PatrolScanJob, type PatrolScanPage, type UserInternalClient,
} from "../src/internal-client";
import { runFullScanJob } from "../src/scheduler/full-scan";

const TOKEN = "worker-token-0123456789abcdef0123456789abcdef";

const usage = {
  inputTokens: { total: 0, noCache: 0, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 0, text: 0, reasoning: 0 },
};
const verdict = (riskLevel = "low", shouldEscalate = false) => ({
  content: [{ type: "text" as const, text: JSON.stringify({ riskLevel, shouldEscalate, reason: "判断" }) }],
  finishReason: { unified: "stop" as const, raw: undefined }, usage, warnings: [],
});

const content = (type: PatrolContentItem["target_type"], id: number): PatrolContentItem => ({
  target_type: type, target_id: id, body: `正文${id}`, author_id: 1, course_id: 2,
});

const jobOf = (overrides: Partial<PatrolScanJob> = {}): PatrolScanJob => ({
  id: 9, status: "running", target_types: ["question", "answer", "comment"],
  cursor_type: null, cursor_id: null, scanned: 0, escalated: 0, skipped: 0, failed: 0,
  cancel_requested: false, created_by: 7, trace_id: "trace", error_summary: null,
  created_at: "2026-11-18T00:00:00", started_at: "2026-11-18T00:00:00", finished_at: null,
  ...overrides,
});

const pageOf = (items: PatrolContentItem[], hasMore: boolean, status = "running"): PatrolScanPage => ({
  job: jobOf({ status: status as PatrolScanJob["status"] }), items, has_more: hasMore,
});

function fixtureClient(pages: PatrolScanPage[]) {
  return {
    audit: {
      createRun: vi.fn().mockResolvedValue({ id: 1 }),
      finishRun: vi.fn().mockResolvedValue({ id: 1 }),
    },
    fetchPatrolScanPage: vi.fn()
      .mockImplementation(async () => pages.shift() ?? pageOf([], false, "succeeded")),
    heartbeatPatrolScan: vi.fn()
      .mockImplementation(async () => ({ job: jobOf(), lease_expires_at: "2026-11-18T00:01:00" })),
    updatePatrolScanProgress: vi.fn().mockImplementation(
      async (_id: number, body: { status?: string }) => jobOf({
        status: (body.status ?? "running") as PatrolScanJob["status"],
      }),
    ),
    createPatrolCase: vi.fn().mockResolvedValue({ repeat: false }),
  } as unknown as UserInternalClient & {
    audit: { createRun: ReturnType<typeof vi.fn>; finishRun: ReturnType<typeof vi.fn> };
    fetchPatrolScanPage: ReturnType<typeof vi.fn>;
    heartbeatPatrolScan: ReturnType<typeof vi.fn>;
    updatePatrolScanProgress: ReturnType<typeof vi.fn>;
    createPatrolCase: ReturnType<typeof vi.fn>;
  };
}

const model = () => new MockLanguageModelV4({ doGenerate: vi.fn().mockResolvedValue(verdict()) });

describe("全量扫描执行器", () => {
  it("按游标分批推进并按批回写进度", async () => {
    const client = fixtureClient([
      pageOf([content("question", 1), content("question", 2)], true),
      pageOf([content("question", 3)], false),
    ]);
    const outcome = await runFullScanJob({ jobId: 9, client, workerToken: TOKEN, getModel: model });

    expect(outcome).toEqual({ status: "succeeded", scanned: 3, escalated: 0, skipped: 3, failed: 0 });
    expect(client.fetchPatrolScanPage).toHaveBeenNthCalledWith(
      1, { jobId: 9, workerToken: TOKEN, limit: 50 }, expect.anything(),
    );
    expect(client.updatePatrolScanProgress).toHaveBeenNthCalledWith(1, 9, {
      workerToken: TOKEN,
      cursorType: "question", cursorId: 2, scannedDelta: 2, escalatedDelta: 0,
      skippedDelta: 2, failedDelta: 0, status: "running", errorSummary: null,
    }, expect.anything());
    expect(client.updatePatrolScanProgress).toHaveBeenNthCalledWith(2, 9, expect.objectContaining({
      cursorId: 3, status: "succeeded",
    }), expect.anything());
    expect(client.audit.finishRun.mock.calls[0][1]).toMatchObject({ status: "succeeded" });
  });

  it("取消在批内生效：已处理条数保留，后续不再调用模型", async () => {
    const client = fixtureClient([
      pageOf([content("question", 1), content("question", 2)], true),
    ]);
    client.heartbeatPatrolScan
      .mockResolvedValueOnce({ job: jobOf(), lease_expires_at: "2026-11-18T00:01:00" })
      .mockResolvedValueOnce({ job: jobOf(), lease_expires_at: "2026-11-18T00:01:00" })
      .mockResolvedValueOnce({
        job: jobOf({ status: "cancelled", cancel_requested: true }),
        lease_expires_at: "2026-11-18T00:01:00",
      });

    const outcome = await runFullScanJob({ jobId: 9, client, workerToken: TOKEN, getModel: model });
    expect(outcome).toMatchObject({ status: "cancelled", scanned: 1 });
    expect(client.createPatrolCase).not.toHaveBeenCalled();
    expect(client.updatePatrolScanProgress).not.toHaveBeenCalled();
    expect(client.audit.finishRun.mock.calls[0][1]).toMatchObject({
      status: "failed", error_summary: "管理员取消扫描",
    });
  });

  it("单条模型失败不阻断后续条目", async () => {
    const client = fixtureClient([
      pageOf([content("question", 1), content("question", 2)], false),
    ]);
    const generate = vi.fn()
      .mockRejectedValueOnce(new Error("timeout"))
      .mockResolvedValueOnce(verdict());
    const outcome = await runFullScanJob({
      jobId: 9, client, workerToken: TOKEN,
      getModel: () => new MockLanguageModelV4({ doGenerate: generate }),
    });
    expect(outcome).toMatchObject({ status: "succeeded", scanned: 2, failed: 1, skipped: 1 });
    expect(client.updatePatrolScanProgress).toHaveBeenCalledWith(9, expect.objectContaining({
      workerToken: TOKEN, failedDelta: 1, skippedDelta: 1, status: "succeeded",
    }), expect.anything());
  });

  it("达到单次上限时标记失败并说明剩余未处理", async () => {
    const client = fixtureClient([
      pageOf([content("question", 1), content("question", 2)], true),
    ]);
    const outcome = await runFullScanJob({
      jobId: 9, client, workerToken: TOKEN, getModel: model, maxItems: 1,
    });
    expect(outcome).toMatchObject({ status: "failed", scanned: 1 });
    expect(client.updatePatrolScanProgress).toHaveBeenCalledWith(9, expect.objectContaining({
      workerToken: TOKEN, status: "failed", errorSummary: expect.stringContaining("单次扫描上限"),
    }), expect.anything());
    expect(client.audit.finishRun.mock.calls[0][1]).toMatchObject({ status: "failed" });
  });

  it("租约丢失时停止执行且不回写任务状态", async () => {
    const client = fixtureClient([]);
    client.heartbeatPatrolScan.mockRejectedValue(
      new InternalApiError(409, 409, "扫描任务已被其他 worker 接管"),
    );
    const outcome = await runFullScanJob({ jobId: 9, client, workerToken: TOKEN, getModel: model });
    expect(outcome.status).toBe("failed");
    expect(client.fetchPatrolScanPage).not.toHaveBeenCalled();
    expect(client.updatePatrolScanProgress).not.toHaveBeenCalled();
    expect(client.audit.finishRun.mock.calls[0][1]).toMatchObject({ status: "failed" });
  });
});
