import "dotenv/config";
import { definePlugin } from "nitro";
import { createAgentBackgroundServices } from "../src/runtime/agent-services.js";

export default definePlugin(async app => {
  const services = createAgentBackgroundServices();
  app.hooks.hook("close", services.close);
  await services.start();
});
