import type { LanguageModel } from "ai";

import { runRecorder } from "../observability/run-recorder.js";
import { dispatchTask } from "../tasks/index.js";
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
    const runContext = beginRun(c, typeParse.data, JSON.stringify(rawBody ?? {}));
    try {
      const data = await dispatchTask(typeParse.data, rawBody, {
        runContext, model, internalClient: c.get("internalClient"),
      });
      runRecorder.finishRun(runContext.agentRunId, { status: "succeeded", outputSummary: JSON.stringify(data) });
      return c.json({ code: 200, data, message: "ok" });
    } catch (error) {
      const mapped = toErrorResponse(error);
      runRecorder.finishRun(runContext.agentRunId, { status: "failed", errorSummary: mapped.message });
      return c.json({ code: mapped.status, data: null, message: mapped.message }, mapped.status);
    }
  });
};
