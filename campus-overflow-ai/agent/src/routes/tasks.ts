import type { LanguageModel } from "ai";

import { dispatchTask } from "../tasks/index.js";
import { ensureBuiltinTools } from "../tools/index.js";
import { createToolRegistry } from "../tools/registry.js";
import { TaskTypeSchema } from "../types/index.js";
import { beginRun, resolveModel, toErrorResponse, type AgentApp, type AppDependencies } from "./support.js";

export const registerTaskRoutes = (app: AgentApp, deps: AppDependencies): void => {
  app.post("/agent/tasks/:type", async (c) => {
    const typeParse = TaskTypeSchema.safeParse(c.req.param("type"));
    if (!typeParse.success) return c.json({ code: 400, data: null, message: "不支持的任务类型" }, 400);
    let model: LanguageModel;
    try {
      model = resolveModel(deps);
    } catch (error) {
      const mapped = toErrorResponse(error);
      return c.json({ code: mapped.status, data: null, message: mapped.message }, mapped.status);
    }
    const rawBody: unknown = await c.req.json().catch(() => undefined);
    const { runContext, audit, control } = beginRun(c, typeParse.data);
    // 请求级工具注册表（G-02/G-03）：每请求独立注册表即当前用户能力集；
    // 无客户端时保持空注册表，任务以无依据模式运行
    const toolRegistry = createToolRegistry();
    const client = c.get("internalClient");
    if (client) {
      ensureBuiltinTools(client, toolRegistry);
    }
    try {
      await audit.create();
      const data = await dispatchTask(typeParse.data, rawBody, {
        runContext, model, internalClient: client, toolRegistry, audit,
      });
      await audit.finish("succeeded");
      return c.json({ code: 200, data, message: "ok" });
    } catch (error) {
      const mapped = toErrorResponse(await audit.onFailure(error));
      return c.json({ code: mapped.status, data: null, message: mapped.message,
        agent_run_id: runContext.agentRunId, trace_id: runContext.traceId }, mapped.status);
    } finally {
      control.dispose();
    }
  });
};
