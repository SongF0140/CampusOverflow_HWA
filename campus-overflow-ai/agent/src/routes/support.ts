import type { Context, Hono } from "hono";
import type { LanguageModel } from "ai";
import { z } from "zod";

import type { AgentEnvironment, UserClientFactory } from "../auth/request-context.js";
import { createLanguageModel, ModelNotConfiguredError } from "../config.js";
import { InternalApiError } from "../internal-client.js";
import { SelfCheckError } from "../loop/self-check.js";
import { ModelCompletionError } from "../loop/model-completion.js";
import { RunStoppedError } from "../loop/abort.js";
import { createRunContext, type RunTaskKind } from "../observability/run-context.js";
import { AuditPersistenceError, PersistentRunAudit } from "../observability/persistent-audit.js";
import { TaskRouterError } from "../tasks/index.js";

export type AgentApp = Hono<AgentEnvironment>;

export interface AppDependencies {
  getModel?: () => LanguageModel;
  /** 每次请求创建客户端；测试替身也必须提供后端身份解析。 */
  createClient?: UserClientFactory;
}

export const resolveModel = (deps: AppDependencies): LanguageModel => deps.getModel?.() ?? createLanguageModel();

export const toErrorResponse = (error: unknown): { status: 400 | 401 | 403 | 408 | 500 | 503 | 504; message: string } => {
  if (error instanceof RunStoppedError) return { status: error.status, message: error.message };
  if (error instanceof AuditPersistenceError) return { status: error.status, message: error.message };
  if (error instanceof InternalApiError) {
    if (error.status === 401 || error.status === 403) {
      return { status: error.status, message: "身份或数据访问权限已失效" };
    }
    return { status: 503, message: "站内数据服务暂不可用，请稍后重试" };
  }
  if (error instanceof z.ZodError) return { status: 400, message: error.issues[0]?.message ?? "参数校验失败" };
  if (error instanceof TaskRouterError) return { status: 400, message: error.message };
  if (error instanceof ModelNotConfiguredError) return { status: 500, message: error.message };
  if (error instanceof ModelCompletionError) return { status: 500, message: error.message };
  if (error instanceof SelfCheckError) return { status: 500, message: "生成结果未通过自检，请重试" };
  return { status: 500, message: "Agent 处理失败，请稍后重试" };
};

export const beginRun = (c: Context<AgentEnvironment>, taskType: RunTaskKind) => {
  const control = c.get("runControl");
  control.start();
  const runContext = createRunContext({ taskType, traceId: c.get("traceId"), principal: c.get("principal"), signal: control.signal });
  return { runContext, control, audit: new PersistentRunAudit(c.get("internalClient").audit, runContext) };
};
