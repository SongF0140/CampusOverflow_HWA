// 夜间离线整理（N-1）测试：误报/漏报/规则失效生成、预算与幂等、手动路由鉴权。
import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AgentEnvironment } from "../src/auth/request-context.js";
import type { PatrolFeedbackItem, UserInternalClient } from "../src/internal-client.js";
import { registerPatrolConsolidationRoute } from "../src/routes/patrol-consolidation.js";
import {
  buildPatrolNotes,
  runPatrolConsolidation,
} from "../src/scheduler/nightly-consolidation.js";

const feedback = (overrides: Partial<PatrolFeedbackItem> = {}): PatrolFeedbackItem => ({
  case_id: 1,
  target_type: "question",
  target_id: 10,
  risk_level: "high",
  source: "agent",
  status: "rejected",
  resolution: null,
  decision_source: "manager_directed",
  reason: "疑似辱骂",
  agent_run_id: "run-1",
  trace_id: "trace-1",
  created_at: "2026-11-10T00:00:00Z",
  resolved_at: "2026-11-10T01:00:00Z",
  ...overrides,
});

const clientOf = (items: PatrolFeedbackItem[]) => ({
  audit: {
    createRun: vi.fn().mockResolvedValue({}),
    finishRun: vi.fn().mockResolvedValue({}),
  },
  fetchPatrolFeedback: vi.fn().mockResolvedValue(items),
  createPatrolNotes: vi.fn().mockResolvedValue({ total: 1, repeated: 0, repeat: false }),
  expirePatrolNotes: vi.fn().mockResolvedValue({ expired: 2 }),
} as unknown as UserInternalClient);

const setupApp = (role: "student" | "admin", client: UserInternalClient) => {
  const app = new Hono<AgentEnvironment>();
  app.use("*", async (c, next) => {
    c.set("principal", {
      user_id: 7, role, status: "active", identity_type: "graduate",
      assistant_cert_status: "approved",
    });
    c.set("internalClient", client);
    c.set("traceId", "trace-route" as never);
    await next();
  });
  registerPatrolConsolidationRoute(app);
  return app;
};

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("离线整理笔记生成", () => {
  it("巡检建单被否决生成误报笔记", () => {
    const notes = buildPatrolNotes([feedback()]);
    expect(notes).toHaveLength(1);
    expect(notes[0].note_type).toBe("false_positive");
    expect(notes[0].summary).toContain("case#1");
    expect(notes[0].summary).not.toContain("疑似辱骂");
  });

  it("管理员直接处置生成漏报线索", () => {
    const notes = buildPatrolNotes([
      feedback({ source: "admin", status: "executed", resolution: "hide" }),
    ]);
    expect(notes[0].note_type).toBe("missed_case");
  });

  it("同组否决比例过高生成规则失效笔记", () => {
    const items = [1, 2, 3, 4, 5].map(id => feedback({ case_id: id, status: "rejected" }));
    const notes = buildPatrolNotes(items);
    const degraded = notes.find(note => note.note_type === "rule_degradation");
    expect(degraded).toBeDefined();
    expect(degraded?.summary).toContain("5 单");
    expect(degraded?.confidence).toBe(100);
  });

  it("样本不足不生成规则失效笔记", () => {
    const items = [1, 2, 3].map(id => feedback({ case_id: id }));
    expect(buildPatrolNotes(items).some(note => note.note_type === "rule_degradation"))
      .toBe(false);
  });

  it("按幂等键去重且最多五条", () => {
    const items = [1, 2, 3, 4, 5, 6].map(id => feedback({ case_id: id }));
    const notes = buildPatrolNotes(items);
    expect(notes).toHaveLength(5);
    expect(new Set(notes.map(note => note.note_key)).size).toBe(5);
  });

  it("同类重复误报累计证据数，单条保持 1", () => {
    const repeated = [1, 2].map(id => feedback({ case_id: id }));
    const notes = buildPatrolNotes(repeated);
    expect(notes.every(note => note.evidence_count === 2)).toBe(true);

    const single = buildPatrolNotes([feedback()]);
    expect(single[0].evidence_count).toBe(1);
  });

  it("长期未处置生成缺口笔记", () => {
    const notes = buildPatrolNotes([
      feedback({
        source: "agent", status: "pending", resolution: null,
        created_at: "2026-11-01T00:00:00Z",
      }),
    ], { now: new Date("2026-11-17T00:00:00Z") });
    const gap = notes.find(note => note.note_type === "gap");
    expect(gap?.summary).toContain("7 天未处置");
  });

  it("高发但未失效的类型生成关注点", () => {
    const items = [1, 2, 3, 4, 5].map(id => feedback({
      case_id: id, status: "executed", resolution: "hide",
    }));
    const notes = buildPatrolNotes(items);
    expect(notes.some(note => note.note_type === "focus")).toBe(true);
    expect(notes.some(note => note.note_type === "rule_degradation")).toBe(false);
  });

  it("预算内为关注点保留席位", () => {
    const focusItems = [1, 2, 3, 4, 5].map(id => feedback({
      case_id: id, target_type: "comment", status: "executed", resolution: "hide",
    }));
    const rejected = [10, 11, 12, 13, 14].map(id => feedback({ case_id: id }));
    const notes = buildPatrolNotes([...focusItems, ...rejected]);
    expect(notes).toHaveLength(5);
    expect(notes.some(note => note.note_type === "focus")).toBe(true);
  });
});

describe("离线整理执行", () => {
  it("写入笔记并记成功终态", async () => {
    const client = clientOf([feedback()]);
    const outcome = await runPatrolConsolidation({ client, days: 14 });
    expect(outcome).toEqual({ analyzed: 1, notes: 1, repeated: 0, expired: 2 });
    expect(client.expirePatrolNotes).toHaveBeenCalledTimes(1);
    expect(client.createPatrolNotes).toHaveBeenCalledTimes(1);
    expect(client.audit.finishRun).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ status: "succeeded" }),
      expect.anything(),
    );
  });

  it("无笔记时不调用写入接口", async () => {
    const client = clientOf([feedback({ status: "executed", resolution: "hide" })]);
    const outcome = await runPatrolConsolidation({ client });
    expect(outcome.notes).toBe(0);
    expect(outcome.expired).toBe(2);
    expect(client.createPatrolNotes).not.toHaveBeenCalled();
  });

  it("过期降级失败时终止并记录失败终态", async () => {
    const client = clientOf([feedback()]);
    client.expirePatrolNotes = vi.fn().mockRejectedValue(new Error("expire down"));
    await expect(runPatrolConsolidation({ client })).rejects.toThrow("expire down");
    expect(client.fetchPatrolFeedback).not.toHaveBeenCalled();
    expect(client.audit.finishRun).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ status: "failed" }),
      expect.anything(),
    );
  });

  it("写入失败记录失败终态并抛出", async () => {
    const client = clientOf([feedback()]);
    client.createPatrolNotes = vi.fn().mockRejectedValue(new Error("db down"));
    await expect(runPatrolConsolidation({ client })).rejects.toThrow("db down");
    expect(client.audit.finishRun).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ status: "failed" }),
      expect.anything(),
    );
  });
});

describe("手动触发路由", () => {
  it("默认关闭返回 503", async () => {
    const response = await setupApp("admin", clientOf([feedback()]))
      .request("/agent/patrol/consolidate", { method: "POST", body: "{}" });
    expect(response.status).toBe(503);
  });

  it("仅管理员可触发", async () => {
    vi.stubEnv("PATROL_CONSOLIDATION_ENABLED", "true");
    const response = await setupApp("student", clientOf([feedback()]))
      .request("/agent/patrol/consolidate", { method: "POST", body: "{}" });
    expect(response.status).toBe(403);
  });

  it("管理员触发返回整理结果", async () => {
    vi.stubEnv("PATROL_CONSOLIDATION_ENABLED", "true");
    const client = clientOf([feedback()]);
    const response = await setupApp("admin", client)
      .request("/agent/patrol/consolidate", {
        method: "POST", body: JSON.stringify({ days: 14 }),
      });
    expect(response.status).toBe(200);
    expect((await response.json()).data).toEqual({
      analyzed: 1, notes: 1, repeated: 0, expired: 2,
    });
    expect(client.fetchPatrolFeedback).toHaveBeenCalledWith({ days: 14, limit: 200 }, expect.anything());
  });
});
