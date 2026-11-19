import "dotenv/config";
import { definePlugin } from "nitro";
import { createAgentBackgroundServices } from "../src/runtime/agent-services.js";
import { createBackgroundServices } from "../src/runtime/background-services.js";
import { startWorkflowRuntime } from "../src/runtime/postgres-runtime.js";

export default definePlugin(async app => {
  const services = createBackgroundServices([startWorkflowRuntime, async () => {
    const background = createAgentBackgroundServices();
    await background.start();
    return background.close;
  }]);
  app.hooks.hook("close", services.close);
  await services.start();
});
