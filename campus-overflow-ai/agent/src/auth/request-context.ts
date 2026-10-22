import { randomUUID } from "node:crypto";
import type { MiddlewareHandler } from "hono";

import { InternalApiError, type UserInternalClient } from "../internal-client.js";
import { RunStoppedError } from "../loop/abort.js";
import { createRunControl, type RunControl } from "../loop/run-control.js";
import { asTraceId, type TraceId } from "../types/index.js";
import { AgentPrincipalSchema, type AgentPrincipal } from "./principal.js";

export interface AgentEnvironment {
  Variables: { principal: AgentPrincipal; internalClient: UserInternalClient; traceId: TraceId; runControl: RunControl };
}

export type UserClientFactory = (authorization: string, signal: AbortSignal) => UserInternalClient;

export const userRequestContext = (createClient: UserClientFactory): MiddlewareHandler<AgentEnvironment> =>
  async (c, next) => {
    const traceId = asTraceId(c.req.header("x-trace-id")?.trim() || randomUUID());
    c.header("x-trace-id", traceId);
    const authorization = c.req.header("authorization");
    if (!authorization || !/^Bearer [A-Za-z0-9._~+/-]+=*$/i.test(authorization)) {
      return c.json({ code: 401, data: null, message: "未登录或登录凭证无效" }, 401);
    }
    const control = createRunControl(c.req.raw.signal);
    c.set("runControl", control);
    try {
      const client = createClient(authorization, control.signal);
      const principal = AgentPrincipalSchema.parse(await client.resolvePrincipal(traceId));
      c.set("principal", principal);
      c.set("internalClient", client);
      c.set("traceId", traceId);
    } catch (error) {
      control.dispose();
      if (error instanceof RunStoppedError) return c.json({ code: error.status, data: null, message: error.message }, error.status);
      const status = error instanceof InternalApiError && (error.status === 401 || error.status === 403)
        ? error.status : 503;
      const message = status === 401 ? "登录凭证无效或已过期"
        : status === 403 ? "账号无权使用智能服务" : "身份验证服务暂不可用，请稍后重试";
      return c.json({ code: status, data: null, message }, status);
    }
    try { await next(); }
    finally {
      // SSE 回调的生命周期长于路由返回，由回调自己释放控制器。
      if (!c.res.headers.get("content-type")?.includes("text/event-stream")) control.dispose();
    }
  };
