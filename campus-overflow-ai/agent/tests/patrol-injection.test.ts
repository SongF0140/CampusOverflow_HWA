// N-3 注入上下文测试：渲染预算、截断合并、管理员只读路由与默认关闭。
import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AgentEnvironment } from "../src/auth/request-context.js";
import type { PatrolNoteItem, UserInternalClient } from "../src/internal-client.js";
import { registerPatrolInjectionRoute } from "../src/routes/patrol-injection.js";
import { buildInjectedContext, renderPatrolContext } from "../src/scheduler/patrol-injection.js";

const note = (overrides: Partial<PatrolNoteItem> = {}): PatrolNoteItem => ({
  id: 1,
  note_key: "false_positive:1:patrol-n1-v1",
  note_type: "false_positive",
  source_case_id: 1,
  target_type: "question",
  target_id: 10,
  rule_version: "patrol-n1-v1",
  model_version: "deterministic",
  summary: "巡检误报：case#1 question#10 risk=high",
  confidence: 90,
  evidence_count: 3,
  valid_until: "2099-01-01T00:00:00",
  status: "active",
  created_at: "2026-11-17T00:00:00",
  ...overrides,
});

const clientOf = (items: PatrolNoteItem[], truncated = false) => ({
  fetchInjectedPatrolNotes: vi.fn().mockResolvedValue({
    items, truncated, max_chars: 2000,
  }),
} as unknown as UserInternalClient);

const setupApp = (role: "student" | "admin", client: UserInternalClient) => {
  const app = new Hono<AgentEnvironment>();
  app.use("*", async (c, next) => {
    c.set("principal", {
      user_id: 7, role, status: "active", identity_type: "graduate",
      assistant_cert_status: "approved",
    });
    c.set("internalClient", client);
    c.set("traceId", "trace-inject" as never);
    await next();
  });
  registerPatrolInjectionRoute(app);
  return app;
};

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("注入上下文渲染", () => {
  it("按类型渲染标签与全局目标", () => {
    const rendered = renderPatrolContext([
      note(),
      note({ id: 2, note_type: "rule_degradation", target_type: null, target_id: null }),
    ]);
    expect(rendered.text).toContain("[误报] question#10");
    expect(rendered.text).toContain("[规则] 全局");
    expect(rendered.count).toBe(2);
    expect(rendered.truncated).toBe(false);
  });

  it("超出字符预算即截断", () => {
    const rendered = renderPatrolContext(
      [note({ summary: "甲".repeat(100) }), note({ id: 2, summary: "乙".repeat(100) })],
      200,
    );
    expect(rendered.count).toBe(1);
    expect(rendered.truncated).toBe(true);
  });

  it("合并后端截断标记", async () => {
    const client = clientOf([note()], true);
    const rendered = await buildInjectedContext({ client, traceId: "t" as never });
    expect(rendered.truncated).toBe(true);
    expect(client.fetchInjectedPatrolNotes).toHaveBeenCalledWith(
      { maxChars: 2000, minConfidence: undefined, limit: undefined },
      "t",
    );
  });
});

describe("注入预览路由", () => {
  it("默认关闭返回 503", async () => {
    const response = await setupApp("admin", clientOf([note()]))
      .request("/agent/patrol/injected-context");
    expect(response.status).toBe(503);
  });

  it("仅管理员可访问", async () => {
    vi.stubEnv("PATROL_INJECTION_ENABLED", "true");
    const response = await setupApp("student", clientOf([note()]))
      .request("/agent/patrol/injected-context");
    expect(response.status).toBe(403);
  });

  it("管理员获取渲染文本", async () => {
    vi.stubEnv("PATROL_INJECTION_ENABLED", "true");
    const client = clientOf([note()]);
    const response = await setupApp("admin", client)
      .request("/agent/patrol/injected-context?max_chars=1000&min_confidence=80");
    expect(response.status).toBe(200);
    const data = (await response.json()).data;
    expect(data.text).toContain("巡检误报");
    expect(data.max_chars).toBe(1000);
    expect(client.fetchInjectedPatrolNotes).toHaveBeenCalledWith(
      { maxChars: 1000, minConfidence: 80, limit: 20 },
      "trace-inject",
    );
  });
});
