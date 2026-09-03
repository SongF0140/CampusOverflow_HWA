// Hono 应用定义：与 server.ts 分离，便于测试直接导入
import { Hono } from "hono";

// 统一响应格式：{ code, data, message }（见 .trae/rules/project-context.md API 约定）
export const healthPayload = () => ({
  code: 200,
  data: { status: "up", service: "agent" },
  message: "ok",
});

export const createApp = (): Hono => {
  const app = new Hono();

  // /health 供运维探针；/agent/health 供前端 rewrites 代理（/api/agent/health）
  app.get("/health", (c) => c.json(healthPayload()));
  app.get("/agent/health", (c) => c.json(healthPayload()));

  return app;
};
