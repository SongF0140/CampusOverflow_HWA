// MCP 外部接入增强（P4）：主/备双凭证轮换、过期拒绝、每客户端限流。
// 覆盖配置兼容、timing-safe 鉴权边界、限流在工具执行前拦截与拒绝审计。
import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type { McpRequestRejectedRecord } from "../src/mcp/audit";
import { createMcpHttpHandler } from "../src/mcp/http";
import {
  authenticateClient,
  loadMcpClients,
  type McpClientConfig,
} from "../src/mcp/policy";
import {
  createTokenBucketRateLimiter,
  resolveRateLimitPerMinute,
} from "../src/mcp/rate-limit";

const clientConfig = (tokens: { token: string; expiresAt?: number }[]): McpClientConfig => ({
  name: "campus-portal",
  scopes: ["read"],
  tokens,
  externalKey: "backend-external-key",
});

describe("MCP 凭证轮换与过期（P4）", () => {
  it("主备两个凭证在轮换期内都能映射同一客户端身份", () => {
    const clients = [clientConfig([{ token: "old-token" }, { token: "new-token" }])];
    expect(authenticateClient("Bearer old-token", clients))
      .toEqual({ name: "campus-portal", scopes: ["read"] });
    expect(authenticateClient("Bearer new-token", clients))
      .toEqual({ name: "campus-portal", scopes: ["read"] });
  });

  it("过期凭证与不存在凭证返回同样的 401 语义（null）", () => {
    const now = Date.parse("2026-11-18T00:00:00Z");
    const clients = [clientConfig([
      { token: "expired-token", expiresAt: now - 1 },
      { token: "active-token", expiresAt: now + 60_000 },
    ])];
    expect(authenticateClient("Bearer expired-token", clients, now)).toBeNull();
    expect(authenticateClient("Bearer unknown-token", clients, now)).toBeNull();
    expect(authenticateClient("Bearer active-token", clients, now))
      .toEqual({ name: "campus-portal", scopes: ["read"] });
  });

  it("到达 expires_at 的时刻即视为过期（边界不含等于）", () => {
    const now = Date.parse("2026-11-18T00:00:00Z");
    const clients = [clientConfig([{ token: "boundary-token", expiresAt: now }])];
    expect(authenticateClient("Bearer boundary-token", clients, now)).toBeNull();
  });

  it("新数组格式解析：字符串与对象凭证、ISO 过期时间、external_key 独立配置", () => {
    const parsed = loadMcpClients(JSON.stringify([{
      name: "campus-portal",
      scopes: ["read"],
      tokens: ["old-token", { token: "new-token", expires_at: "2026-12-01T00:00:00Z" }],
      external_key: "backend-external-key",
    }]));
    expect(parsed).toEqual([{
      name: "campus-portal",
      scopes: ["read"],
      tokens: [
        { token: "old-token" },
        { token: "new-token", expiresAt: Date.parse("2026-12-01T00:00:00Z") },
      ],
      externalKey: "backend-external-key",
    }]);
  });

  it("旧单 token 格式继续可用，外部密钥回退为该凭证", () => {
    expect(loadMcpClients(JSON.stringify([
      { name: "campus-portal", token: "legacy-token", scopes: ["read"] },
    ]))).toEqual([{
      name: "campus-portal",
      scopes: ["read"],
      tokens: [{ token: "legacy-token" }],
      externalKey: "legacy-token",
    }]);
  });

  it.each([
    ["超过两个凭证", [{ name: "a", scopes: ["read"], tokens: ["t1", "t2", "t3"] }]],
    ["同时配置 token 与 tokens", [{ name: "a", token: "t1", tokens: ["t2"], scopes: ["read"] }]],
    ["跨客户端重复凭证", [
      { name: "a", scopes: ["read"], tokens: ["same"] },
      { name: "b", scopes: ["read"], tokens: ["same"] },
    ]],
    ["重复外部密钥", [
      { name: "a", scopes: ["read"], tokens: ["t1"], external_key: "same-key" },
      { name: "b", scopes: ["read"], tokens: ["t2"], external_key: "same-key" },
    ]],
    ["非法过期时间", [{ name: "a", scopes: ["read"], tokens: [{ token: "t1", expires_at: "not-a-date" }] }]],
    ["空凭证数组", [{ name: "a", scopes: ["read"], tokens: [] }]],
  ])("%s 启动即失败", (_label, config) => {
    expect(() => loadMcpClients(JSON.stringify(config))).toThrow();
  });
});

describe("MCP 每客户端限流（P4）", () => {
  it("默认每分钟额度内放行，超限拒绝；时间推进后恢复", () => {
    let current = 0;
    const limiter = createTokenBucketRateLimiter(2, { now: () => current });
    expect(limiter.tryAcquire("a")).toBe(true);
    expect(limiter.tryAcquire("a")).toBe(true);
    expect(limiter.tryAcquire("a")).toBe(false);
    // 60 秒补满 2 个令牌
    current += 60_000;
    expect(limiter.tryAcquire("a")).toBe(true);
    expect(limiter.tryAcquire("a")).toBe(true);
    expect(limiter.tryAcquire("a")).toBe(false);
  });

  it("限流按客户端独立计费", () => {
    const limiter = createTokenBucketRateLimiter(1, { now: () => 0 });
    expect(limiter.tryAcquire("a")).toBe(true);
    expect(limiter.tryAcquire("a")).toBe(false);
    expect(limiter.tryAcquire("b")).toBe(true);
  });

  it.each([
    [undefined, 60],
    ["", 60],
    ["30", 30],
  ])("resolveRateLimitPerMinute(%s) → %s", (raw, expected) => {
    expect(resolveRateLimitPerMinute(raw)).toBe(expected);
  });

  it.each(["0", "-1", "abc", "1.5"])("非法限流配置 %s 启动即失败", (raw) => {
    expect(() => resolveRateLimitPerMinute(raw)).toThrow();
  });
});

describe("MCP HTTP：限流在工具执行前拦截（P4）", () => {
  let port = 0;
  let closeServer = async () => {};
  let rejected: McpRequestRejectedRecord[];
  const sessionFactory = vi.fn();

  beforeAll(async () => {
    rejected = [];
    const handler = createMcpHttpHandler({
      clients: [clientConfig([{ token: "active-token" }])],
      sessionFactory,
      audit: {
        record: () => undefined,
        recordRejected: (record) => { rejected.push(record); },
      },
      rateLimiter: { limitPerMinute: 60, tryAcquire: () => false },
    });
    const server = http.createServer((req, res) => {
      handler(req, res).catch(() => {
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ code: 500, data: null, message: "MCP 服务内部错误" }));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    port = (server.address() as AddressInfo).port;
    closeServer = () => new Promise<void>((resolve) => server.close(() => resolve()));
  });

  afterAll(async () => { await closeServer(); });

  it("超限返回 429、不创建会话、写拒绝审计且不回显凭证", async () => {
    sessionFactory.mockClear();
    const response = await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer active-token" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    expect(response.status).toBe(429);
    const body = await response.json() as { message: string };
    expect(body.message).toContain("请求过于频繁");
    expect(JSON.stringify(body)).not.toContain("active-token");
    expect(sessionFactory).not.toHaveBeenCalled();
    expect(rejected).toHaveLength(1);
    expect(rejected[0]).toMatchObject({
      event: "mcp_request_rejected",
      client: "campus-portal",
      reason: "rate_limited",
      limit_per_minute: 60,
      trace_id: expect.stringMatching(/^mcp-/),
    });
  });
});

describe("MCP HTTP：过期凭证直接 401（P4）", () => {
  let port = 0;
  let closeServer = async () => {};
  const sessionFactory = vi.fn();

  beforeAll(async () => {
    const handler = createMcpHttpHandler({
      clients: [clientConfig([{ token: "expired-token", expiresAt: Date.now() - 1_000 }])],
      sessionFactory,
    });
    const server = http.createServer((req, res) => {
      handler(req, res).catch(() => {
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ code: 500, data: null, message: "MCP 服务内部错误" }));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    port = (server.address() as AddressInfo).port;
    closeServer = () => new Promise<void>((resolve) => server.close(() => resolve()));
  });

  afterAll(async () => { await closeServer(); });

  it("过期 token 与未知 token 返回同样的 401 文案", async () => {
    const expired = await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer expired-token" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    expect(expired.status).toBe(401);
    const expiredBody = await expired.json() as { message: string };
    expect(expiredBody.message).toContain("MCP 凭证");

    const unknown = await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer unknown-token" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    expect(unknown.status).toBe(401);
    expect((await unknown.json() as { message: string }).message).toBe(expiredBody.message);
    expect(sessionFactory).not.toHaveBeenCalled();
  });
});
