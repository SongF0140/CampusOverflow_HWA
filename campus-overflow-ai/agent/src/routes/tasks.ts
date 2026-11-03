import type { LanguageModel } from "ai";

import { dispatchTask } from "../tasks/index.js";
import { runReviewed } from "../loop/reviewed-run.js";
import { createRequestTools } from "../tools/request-tools.js";
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
    const client = c.get("internalClient");
    const toolRegistry = createRequestTools(client, c.get("principal"), undefined, deps.webTools);
    try {
      await audit.create();
      const data = await runReviewed({ kind: typeParse.data, input: rawBody, model, run: runContext,
        produce: (feedback) => dispatchTask(typeParse.data, rawBody, {
          runContext, model, internalClient: client, toolRegistry, audit, feedback,
        }) });
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
