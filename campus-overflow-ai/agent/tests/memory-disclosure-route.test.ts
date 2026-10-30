import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import type { AgentEnvironment } from "../src/auth/request-context.js";
import { registerSessionRoutes } from "../src/routes/sessions.js";

const setup = () => {
  const app = new Hono<AgentEnvironment>();
  app.use("*", async (c, next) => {
    c.set("principal", { user_id: 7, role: "student", status: "active", identity_type: "undergraduate", assistant_cert_status: "none" });
    await next();
  });
  registerSessionRoutes(app);
  return app;
};
const payload = { owner_id: 7, session_id: "f81d4fae-7dec-41d0-a765-00a0c91e6bf6", message: "死锁", stage: "index", items: [{ id: "a", text: "死锁" }] };
const request = (body: unknown) => setup().request("/agent/sessions/memory/disclose", { method: "POST", body: JSON.stringify(body) });

describe("账号绑定的渐进记忆路由", () => {
  it("只返回所选ID，不回显索引正文，响应禁止缓存", async () => {
    const response = await request(payload);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect((await response.json()).data).toEqual({ session_id: payload.session_id, stage: "index", selected_ids: ["a"] });
  });
  it("拒绝其他账号和重复ID", async () => {
    expect((await request({ ...payload, owner_id: 8 })).status).toBe(403);
    expect((await request({ ...payload, items: [...payload.items, ...payload.items] })).status).toBe(400);
  });
  it("额外权限字段与索引全文拒绝", async () => {
    expect((await request({ ...payload, role: "admin" })).status).toBe(400);
    expect((await request({ ...payload, items: [{ id: "a", text: "字".repeat(37) }] })).status).toBe(400);
  });
});
