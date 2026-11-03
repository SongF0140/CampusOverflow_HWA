import { defineConfig } from "nitro";
import type { NitroConfig } from "nitro/types";
import type { ModuleOptions } from "workflow/nitro";

const config = {
  preset: "node-server",
  builder: "rollup",
  // 统一打包World代码，避免追踪时外部化已加载模块破坏Rollup的Schema导入关联。
  noExternals: ["@workflow/world-postgres"],
  // 保留PG World/Graphile运行时SQL与模块布局，避免打包器遗漏动态读取文件。
  traceDeps: ["@workflow/world-postgres*", "graphile-worker*", "tslib*", "agent-browser*"],
  serverDir: "./",
  modules: ["workflow/nitro"],
  routes: { "/**": "./src/server.ts" },
  workflow: { dirs: ["src/workflows"], dashboard: false },
} satisfies NitroConfig & { workflow: ModuleOptions };

export default defineConfig(config);
