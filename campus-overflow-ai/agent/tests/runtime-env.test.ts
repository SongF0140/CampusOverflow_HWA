import { expect, it } from "vitest";
import { applyRuntimeEnvironment } from "../scripts/runtime-env.mjs";

it("保持8787默认端口，Nitro和Node一致", () => {
  const env: Record<string, string> = {};
  applyRuntimeEnvironment(env);
  expect(env).toMatchObject({ PORT: "8787", NITRO_PORT: "8787" });
});
it("兼容AGENT_PORT并优先于通用端口", () => {
  const env = { AGENT_PORT: "8877", PORT: "3000", NITRO_PORT: "3001" };
  applyRuntimeEnvironment(env);
  expect(env).toMatchObject({ PORT: "8877", NITRO_PORT: "8877" });
});
it("未指定AGENT_PORT时支持Nitro的端口配置", () => {
  const env = { NITRO_PORT: "8878", PORT: "3000" };
  applyRuntimeEnvironment(env);
  expect(env).toMatchObject({ PORT: "8878", NITRO_PORT: "8878" });
});
it.each(["0", "65536", "abc", "8787.5"])("无效端口%s在启动前明确拒绝", port => {
  expect(() => applyRuntimeEnvironment({ AGENT_PORT: port })).toThrow();
});
