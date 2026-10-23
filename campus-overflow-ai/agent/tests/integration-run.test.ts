// 跨服务集成验证（G-06）：真实 app 装配（不注入客户端）+ 真实 internal-client 经 HTTP
// 访问本地 mock 后端；只替换外部模型与后端进程，验证"身份 → 计划 → 工具 → 总结审查
// → 持久审计"完整链路、双凭证/user 路径/trace 透传契约与各错误分支。
// BFF → Agent 契约由 frontend route 测试保证，此处按 BFF 发送的请求格式发起调用。
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { MockLanguageModelV4, simulateReadableStream } from "ai/test";

import { createApp } from "../src/app";
import { approvedReview } from "./helpers/review-response";

const SERVICE_TOKEN = "integration-service-token";
const USER_JWT = "header.payload.integration-signature";
const TRACE_ID = "trace-integration";
// 与 BFF 转发一致的固定请求头：用户 Bearer + trace id
const AUTH_HEADERS = { authorization: `Bearer ${USER_JWT}`, "x-trace-id": TRACE_ID };

const usage = {
  inputTokens: { total: 0, noCache: 0, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 0, text: 0, reasoning: 0 },
};

interface RecordedRequest {
  method: string;
  path: string;
  query: URLSearchParams;
  serviceToken: string | null;
  authorization: string | null;
  traceId: string | null;
  body: Record<string, unknown> | undefined;
}

/** 场景覆写：状态码非空时 mock 后端按该状态返回统一错误信封 */
interface BackendBehavior {
  principal?: number;
  questionSearch?: number;
  createRun?: number;
  events?: number;
  finish?: number;
}

let behavior: BackendBehavior = {};
let recorded: RecordedRequest[] = [];
let eventSequence = 0;

const failEnvelope = (status: number) => ({ code: status, data: null, message: `模拟后端 ${status} 错误` });
const okEnvelope = (data: unknown) => ({ code: 200, data, message: "ok" });

// 本地 mock 后端：按 /internal/agent/* 白名单契约响应，真实 HTTP 往返（含 header 与 JSON 序列化）
const server = http.createServer((request, response) => {
  const chunks: Buffer[] = [];
  request.on("data", (chunk: Buffer) => chunks.push(chunk));
  request.on("end", () => {
    const url = new URL(request.url ?? "/", "http://backend.internal");
    const path = url.pathname;
    const rawBody = chunks.length === 0 ? undefined : Buffer.concat(chunks).toString("utf8");
    let body: Record<string, unknown> | undefined;
    try { body = rawBody === undefined ? undefined : JSON.parse(rawBody) as Record<string, unknown>; } catch { body = undefined; }
    const headers = request.headers;
    recorded.push({
      method: request.method ?? "",
      path,
      query: url.searchParams,
      serviceToken: typeof headers["x-service-token"] === "string" ? headers["x-service-token"] : null,
      authorization: typeof headers.authorization === "string" ? headers.authorization : null,
      traceId: typeof headers["x-trace-id"] === "string" ? headers["x-trace-id"] : null,
      body,
    });
    const json = (status: number, payload: unknown) => {
      response.writeHead(status, { "content-type": "application/json" });
      response.end(JSON.stringify(payload));
    };
    // /internal/agent/user/runs/<id>/events 与 /internal/agent/user/runs/<id> 的 run id 都在第 6 段
    const runSegments = path.split("/");
    const runPathId = () => decodeURIComponent(runSegments[5] ?? "");

    if (request.method === "GET" && path === "/internal/agent/principal") {
      if (behavior.principal !== undefined) return json(behavior.principal, failEnvelope(behavior.principal));
      return json(200, okEnvelope({
        user_id: 3, role: "student", status: "active",
        identity_type: "undergraduate", assistant_cert_status: "none",
      }));
    }
    if (request.method === "POST" && path === "/internal/agent/user/runs") {
      if (behavior.createRun !== undefined) return json(behavior.createRun, failEnvelope(behavior.createRun));
      return json(200, okEnvelope({
        id: 101, user_id: 3, agent_run_id: body?.agent_run_id, trace_id: headers["x-trace-id"], status: "running",
      }));
    }
    if (request.method === "POST" && /^\/internal\/agent\/user\/runs\/[^/]+\/events$/.test(path)) {
      if (behavior.events !== undefined) return json(behavior.events, failEnvelope(behavior.events));
      eventSequence += 1;
      return json(200, okEnvelope({
        id: 1, sequence_no: eventSequence, agent_run_id: runPathId(), trace_id: headers["x-trace-id"],
        event_type: body?.event_type, plan_revision: body?.plan_revision,
        steps: body?.steps ?? null, step_id: body?.step_id ?? null,
        tool_name: body?.tool_name ?? null, duration_ms: body?.duration_ms ?? null,
      }));
    }
    if (request.method === "PATCH" && /^\/internal\/agent\/user\/runs\/[^/]+$/.test(path)) {
      if (behavior.finish !== undefined) return json(behavior.finish, failEnvelope(behavior.finish));
      return json(200, okEnvelope({
        id: 101, user_id: 3, agent_run_id: runPathId(), trace_id: headers["x-trace-id"], status: body?.status,
      }));
    }
    if (request.method === "GET" && path === "/internal/agent/user/questions/search") {
      if (behavior.questionSearch !== undefined) return json(behavior.questionSearch, failEnvelope(behavior.questionSearch));
      return json(200, okEnvelope({
        items: [{ id: 9, title: "真实问题", course_id: 2, status: "open" }], total: 1,
      }));
    }
    if (request.method === "GET" && path === "/internal/agent/user/courses/search") {
      return json(200, okEnvelope({ items: [{ id: 2, name: "操作系统", code: "CS101" }], total: 1 }));
    }
    if (request.method === "GET" && path === "/internal/agent/user/tags") {
      return json(200, okEnvelope({ items: [{ id: 5, name: "并发", type: "tech" }], total: 1 }));
    }
    if (request.method === "GET" && path === "/internal/agent/user/moderation-targets/answer/12") {
      return json(200, okEnvelope({
        target_type: "answer", target_id: 12, author_id: 1, course_id: 2, title: null, body: "真实原文",
      }));
    }
    return json(404, failEnvelope(404));
  });
});

/** 模型替身：结构化输出按队列返回，审查器提示词由 approvedReview 识别；流式输出用于聊天 */
const modelFixture = (outputs: unknown[], chatText = "已核验的建议") => {
  const queue = [...outputs];
  const generate = vi.fn(async (options: Parameters<MockLanguageModelV4["doGenerate"]>[0]) =>
    approvedReview(options) ?? {
      content: [{ type: "text" as const, text: JSON.stringify(queue.shift()) }],
      finishReason: { unified: "stop" as const, raw: undefined }, usage, warnings: [],
    });
  const stream = vi.fn(async () => ({ stream: simulateReadableStream({ chunks: [
    { type: "stream-start", warnings: [] }, { type: "text-start", id: "t1" },
    { type: "text-delta", id: "t1", delta: chatText }, { type: "text-end", id: "t1" },
    { type: "finish", finishReason: { unified: "stop", raw: undefined }, usage },
  ] }) }));
  return { model: new MockLanguageModelV4({ doGenerate: generate, doStream: stream }), generate, stream };
};

const planOf = (steps: Array<{ stepId: string; toolName: string; args: Record<string, unknown> }>) => ({
  steps: steps.map((step) => ({ objective: "读取本次任务所需证据", ...step })),
});
const searchPlan = planOf([{ stepId: "s1", toolName: "searchQuestions", args: { keyword: "线程", courseId: "$input.courseId", limit: 5 } }]);
const draftOutput = { title: "线程讲解", bodyMarkdown: "参考[真实问题](/questions/9)。" };
const draftInput = { topic: "线程", courseId: 2 };

/** 全部后端请求必须同时携带服务 token、用户 Bearer 与同一 trace id（双凭证 + C-08） */
const assertCredentialsOnEveryCall = () => {
  expect(recorded).not.toHaveLength(0);
  for (const call of recorded) {
    expect(call.serviceToken).toBe(SERVICE_TOKEN);
    expect(call.authorization).toBe(`Bearer ${USER_JWT}`);
    expect(call.traceId).toBe(TRACE_ID);
  }
};

describe("跨服务集成：身份 → 计划 → 工具 → 总结 → 审计", () => {
  let originalEnv: { BACKEND_BASE_URL?: string; AGENT_SERVICE_TOKEN?: string };

  beforeAll(async () => {
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;
    originalEnv = {
      BACKEND_BASE_URL: process.env.BACKEND_BASE_URL,
      AGENT_SERVICE_TOKEN: process.env.AGENT_SERVICE_TOKEN,
    };
    process.env.BACKEND_BASE_URL = `http://127.0.0.1:${port}`;
    process.env.AGENT_SERVICE_TOKEN = SERVICE_TOKEN;
  });

  afterAll(async () => {
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  beforeEach(() => {
    recorded = [];
    eventSequence = 0;
    behavior = {};
  });

  afterEach(() => { vi.restoreAllMocks(); });

  it("doc_draft 完整链路：双凭证检索 user 路径、蛇形审计事件、succeeded 终态", async () => {
    const f = modelFixture([searchPlan, draftOutput]);
    const app = createApp({ getModel: () => f.model });
    const response = await app.request("/agent/tasks/doc_draft", {
      method: "POST", headers: AUTH_HEADERS, body: JSON.stringify(draftInput),
    });
    expect(response.status).toBe(200);
    const payload = (await response.json()) as { code: number; data: unknown };
    expect(payload.code).toBe(200);
    expect(payload.data).toEqual(draftOutput);
    assertCredentialsOnEveryCall();

    const createRun = recorded.find((call) => call.path === "/internal/agent/user/runs");
    expect(createRun?.body).toMatchObject({ task_type: "doc_draft", input_summary: "用户任务：doc_draft" });
    const runId = createRun?.body?.agent_run_id as string;
    expect(runId).toEqual(expect.any(String));
    const paths = recorded.map((call) => `${call.method} ${call.path.replace(runId, "<run>")}`);
    expect(paths).toEqual([
      "GET /internal/agent/principal",
      "POST /internal/agent/user/runs",
      "POST /internal/agent/user/runs/<run>/events",
      "POST /internal/agent/user/runs/<run>/events",
      "GET /internal/agent/user/questions/search",
      "POST /internal/agent/user/runs/<run>/events",
      "PATCH /internal/agent/user/runs/<run>",
    ]);

    const search = recorded.find((call) => call.path === "/internal/agent/user/questions/search");
    expect(search?.query.get("keyword")).toBe("线程");
    expect(search?.query.get("course_id")).toBe("2");

    const events = recorded.filter((call) => call.path.endsWith("/events"));
    expect(events[0]?.body).toMatchObject({
      event_type: "plan", plan_revision: 1,
      steps: [{ step_id: "s1", tool_name: "searchQuestions" }],
    });
    expect(events[0]?.body).not.toHaveProperty("objective");
    expect(events[1]?.body).toMatchObject({ event_type: "step_started", step_id: "s1", tool_name: "searchQuestions" });
    expect(events[2]?.body).toMatchObject({ event_type: "step_succeeded", step_id: "s1", duration_ms: expect.any(Number) });

    const finish = recorded.find((call) => call.method === "PATCH");
    expect(finish?.body).toEqual({ status: "succeeded", output_summary: "任务已完成" });
    expect(finish?.body).not.toHaveProperty("error_summary");

    expect(f.generate).toHaveBeenCalledTimes(3);
    const responseText = JSON.stringify(payload);
    expect(responseText).not.toContain(USER_JWT);
    expect(responseText).not.toContain(SERVICE_TOKEN);
  });

  it("suggest_tags 链路：词表走 user 路径且站内标签 ID 由程序映射", async () => {
    const plan = planOf([{ stepId: "s1", toolName: "fetchTags", args: { limit: 5 } }]);
    const output = { tags: [{ name: "并发", reason: "主题相关", confidence: 0.8 }] };
    const f = modelFixture([plan, output]);
    const app = createApp({ getModel: () => f.model });
    const response = await app.request("/agent/tasks/suggest_tags", {
      method: "POST", headers: AUTH_HEADERS,
      body: JSON.stringify({ questionTitle: "线程", questionBody: "并发" }),
    });
    expect(response.status).toBe(200);
    const payload = (await response.json()) as { data: { tags: Array<{ tagId: number; name: string }> } };
    expect(payload.data.tags[0]).toMatchObject({ tagId: 5, name: "并发" });
    assertCredentialsOnEveryCall();

    const tags = recorded.find((call) => call.path === "/internal/agent/user/tags");
    expect(tags?.query.get("limit")).toBe("5");
    expect(recorded.find((call) => call.method === "PATCH")?.body).toMatchObject({ status: "succeeded" });
  });

  it("moderation_scan 链路：正文经双凭证 user 路径读取且目标回显一致", async () => {
    const plan = planOf([{ stepId: "s1", toolName: "fetchModerationTarget", args: { targetType: "$input.targetType", targetId: "$input.targetId" } }]);
    const output = { riskLevel: "high", shouldEscalate: true, reason: "需要人工复核" };
    const f = modelFixture([plan, output]);
    const app = createApp({ getModel: () => f.model });
    const response = await app.request("/agent/tasks/moderation_scan", {
      method: "POST", headers: AUTH_HEADERS,
      body: JSON.stringify({ targetType: "answer", targetId: 12, contentExcerpt: "请求方摘录" }),
    });
    expect(response.status).toBe(200);
    assertCredentialsOnEveryCall();
    expect(recorded.some((call) => call.path === "/internal/agent/user/moderation-targets/answer/12")).toBe(true);
    // 真实原文（而非请求方摘录）进入最终评估提示，输出为脱敏的结构化结论
    const evaluationPrompt = JSON.stringify(f.model.doGenerateCalls[1]?.prompt);
    expect(evaluationPrompt).toContain("真实原文");
    expect(evaluationPrompt).not.toContain("请求方摘录");
    const payload = (await response.json()) as { data: { riskLevel: string } };
    expect(payload.data.riskLevel).toBe("high");
    expect(recorded.find((call) => call.method === "PATCH")?.body).toMatchObject({ status: "succeeded" });
  });

  it("聊天链路：零步计划 → 流式候选 → 审查后投递 meta/delta/done", async () => {
    const f = modelFixture([{ steps: [] }]);
    const app = createApp({ getModel: () => f.model });
    const response = await app.request("/agent/chat", {
      method: "POST", headers: AUTH_HEADERS, body: JSON.stringify({ message: "解释线程" }),
    });
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).toContain("event: meta");
    expect(text).toContain("event: delta");
    expect(text).toContain("已核验的建议");
    expect(text).toContain("event: done");
    expect(text).not.toContain(USER_JWT);
    expect(text).not.toContain(SERVICE_TOKEN);
    assertCredentialsOnEveryCall();

    // 计划事件 steps 为空也必须记录，随后直接进入终态
    const events = recorded.filter((call) => call.path.endsWith("/events"));
    expect(events.map((call) => call.body?.event_type)).toEqual(["plan"]);
    expect(events[0]?.body?.steps).toEqual([]);
    expect(recorded.find((call) => call.method === "PATCH")?.body).toMatchObject({ status: "succeeded" });
    expect(f.generate).toHaveBeenCalledTimes(2);
    expect(f.stream).toHaveBeenCalledTimes(1);
  });

  it("后端拒绝用户凭证（401）：不创建运行、不生成任何计划", async () => {
    behavior.principal = 401;
    const f = modelFixture([searchPlan, draftOutput]);
    const app = createApp({ getModel: () => f.model });
    const response = await app.request("/agent/tasks/doc_draft", {
      method: "POST", headers: AUTH_HEADERS, body: JSON.stringify(draftInput),
    });
    expect(response.status).toBe(401);
    const payload = (await response.json()) as { code: number; message: string };
    expect(payload).toMatchObject({ code: 401, message: "登录凭证无效或已过期" });
    expect(recorded.map((call) => call.path)).toEqual(["/internal/agent/principal"]);
    expect(f.generate).not.toHaveBeenCalled();
  });

  it("封禁账号（403）：明确拒绝且不降级为匿名", async () => {
    behavior.principal = 403;
    const f = modelFixture([searchPlan, draftOutput]);
    const app = createApp({ getModel: () => f.model });
    const response = await app.request("/agent/tasks/doc_draft", {
      method: "POST", headers: AUTH_HEADERS, body: JSON.stringify(draftInput),
    });
    expect(response.status).toBe(403);
    const payload = (await response.json()) as { code: number; message: string };
    expect(payload).toMatchObject({ code: 403, message: "账号无权使用智能服务" });
    expect(recorded.map((call) => call.path)).toEqual(["/internal/agent/principal"]);
    expect(f.generate).not.toHaveBeenCalled();
  });

  it("工具调用中撤权（403）：立即失败、写入 failed 终态且不泄漏后端原因", async () => {
    behavior.questionSearch = 403;
    const f = modelFixture([searchPlan, draftOutput]);
    const app = createApp({ getModel: () => f.model });
    const response = await app.request("/agent/tasks/doc_draft", {
      method: "POST", headers: AUTH_HEADERS, body: JSON.stringify(draftInput),
    });
    expect(response.status).toBe(403);
    const text = await response.text();
    expect(text).toContain("身份或数据访问权限已失效");
    expect(text).not.toContain("模拟后端 403 错误");
    assertCredentialsOnEveryCall();

    const eventTypes = recorded.filter((call) => call.path.endsWith("/events")).map((call) => call.body?.event_type);
    expect(eventTypes).toEqual(["plan", "step_started", "step_failed"]);
    const finish = recorded.find((call) => call.method === "PATCH");
    expect(finish?.body).toMatchObject({ status: "failed" });
    expect(finish?.body?.error_summary).toEqual(expect.any(String));
    // 撤权后不再生成最终草稿，也不进入返工
    expect(f.generate).toHaveBeenCalledTimes(1);
  });

  it("审计创建失败（503）：不进入模型与工具执行", async () => {
    behavior.createRun = 503;
    const f = modelFixture([searchPlan, draftOutput]);
    const app = createApp({ getModel: () => f.model });
    const response = await app.request("/agent/tasks/doc_draft", {
      method: "POST", headers: AUTH_HEADERS, body: JSON.stringify(draftInput),
    });
    expect(response.status).toBe(503);
    const payload = (await response.json()) as { code: number; message: string };
    expect(payload).toMatchObject({ code: 503, message: "运行记录未完成，请稍后重试" });
    expect(recorded.map((call) => `${call.method} ${call.path}`)).toEqual([
      "GET /internal/agent/principal",
      "POST /internal/agent/user/runs",
    ]);
    expect(f.generate).not.toHaveBeenCalled();
  });

  it("审计事件写入失败（503）：停止后续工具执行并补写 failed 终态", async () => {
    behavior.events = 503;
    const f = modelFixture([searchPlan, draftOutput]);
    const app = createApp({ getModel: () => f.model });
    const response = await app.request("/agent/tasks/doc_draft", {
      method: "POST", headers: AUTH_HEADERS, body: JSON.stringify(draftInput),
    });
    expect(response.status).toBe(503);
    const payload = (await response.json()) as { code: number; message: string };
    expect(payload).toMatchObject({ code: 503, message: "运行记录未完成，请稍后重试" });
    const paths = recorded.map((call) => `${call.method} ${call.path}`);
    // 计划事件写失败后：不再读取站内数据，也不再追加步骤事件；终态按失败补写
    expect(paths.some((p) => /^POST \/internal\/agent\/user\/runs\/[^/]+\/events$/.test(p))).toBe(true);
    expect(paths.some((p) => p.includes("/questions/search"))).toBe(false);
    const finish = recorded.find((call) => call.method === "PATCH");
    expect(finish?.body).toMatchObject({ status: "failed" });
    expect(f.generate).toHaveBeenCalledTimes(1);
  });

  it("终态写入失败（503）：不返回成功，也不泄漏后端错误原文", async () => {
    behavior.finish = 503;
    const f = modelFixture([searchPlan, draftOutput]);
    const app = createApp({ getModel: () => f.model });
    const response = await app.request("/agent/tasks/doc_draft", {
      method: "POST", headers: AUTH_HEADERS, body: JSON.stringify(draftInput),
    });
    expect(response.status).toBe(503);
    const text = await response.text();
    expect(text).toContain("运行记录未完成，请稍后重试");
    expect(text).not.toContain("模拟后端 503 错误");
    // 检索与总结已真实发生，但成功未落库，不能向调用方报成功
    expect(recorded.some((call) => call.path.includes("/questions/search"))).toBe(true);
    expect(recorded.find((call) => call.method === "PATCH")).toBeDefined();
    expect(f.generate).toHaveBeenCalledTimes(3);
  });
});
