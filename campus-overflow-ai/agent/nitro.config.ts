import { defineConfig } from "nitro";
import type { NitroConfig } from "nitro/types";
import type { ModuleOptions } from "workflow/nitro";

const config = {
  preset: "node-server",
  builder: "rollup",
  serverDir: "./",
  modules: ["workflow/nitro"],
  routes: { "/**": "./src/server.ts" },
  workflow: { dirs: ["src/workflows"], dashboard: false },
} satisfies NitroConfig & { workflow: ModuleOptions };

export default defineConfig(config);
