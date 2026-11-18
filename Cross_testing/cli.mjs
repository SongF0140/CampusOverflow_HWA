/** 从仓库根运行 Cross_testing，复用 campus-overflow-ai/agent 的 tsx 依赖。 */

import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const agentDir = resolve(here, "../campus-overflow-ai/agent");
const mode = process.argv[2] ?? "test";
const extra = process.argv.slice(3);

if (mode !== "test" && mode !== "rag") {
  console.error("用法：node cli.mjs [test|rag] [--dataset path] [--top-k 5]");
  process.exit(1);
}

const target = resolve(here, mode === "test" ? "harness.test.ts" : "run-ablation.mjs");
const args = ["--import", "tsx"];
if (mode === "test") args.push("--test");
args.push(target, ...extra);

const result = spawnSync(process.execPath, args, { cwd: agentDir, stdio: "inherit" });
process.exit(result.status ?? 1);
