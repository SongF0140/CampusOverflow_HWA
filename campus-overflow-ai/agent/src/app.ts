// 应用只装配路由和必经的用户认证；用户客户端与工具均按请求创建。
import { Hono } from "hono";

import { userRequestContext, type AgentEnvironment } from "./auth/request-context.js";
import { defaultInternalClient } from "./internal-client.js";
import { registerChatRoute } from "./routes/chat.js";
import { registerTaskRoutes } from "./routes/tasks.js";
import type { AgentApp, AppDependencies } from "./routes/support.js";

export type { AppDependencies } from "./routes/support.js";

export const healthPayload = () => ({
  code: 200, data: { status: "up", service: "agent" }, message: "ok",
});

export const createApp = (deps: AppDependencies = {}): AgentApp => {
  const app = new Hono<AgentEnvironment>();
  // 探针在认证中间件前注册，不依赖数据库、登录态或模型服务。
  app.get("/health", (c) => c.json(healthPayload()));
  app.get("/agent/health", (c) => c.json(healthPayload()));
  app.use("/agent/*", userRequestContext(deps.createClient ?? defaultInternalClient));
  registerChatRoute(app, deps);
  registerTaskRoutes(app, deps);
  return app;
};
