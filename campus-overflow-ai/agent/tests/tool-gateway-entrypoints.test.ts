import { expect, it, vi } from "vitest";
import { z } from "zod";
import { createToolRegistry } from "../src/tools/registry.js";
import { executePlan } from "../src/loop/plan-executor.js";
import { createRunContext } from "../src/observability/run-context.js";

it.each(["chat", "patrol"] as const)("%s实际计划入口拒绝后不发业务请求", async source => {
  const http = vi.fn(async () => ({ ok: true }));
  const registry = createToolRegistry({ hooks: async () => ({ kind: "deny", reason_code: "policy_denied" }) });
  registry.registerTool({ name: "read", description: "读取", riskLevel: "low", inputSchema: z.object({}), execute: http });
  await expect(executePlan({ steps: [{ stepId: "s1", objective: "读取", toolName: "read", args: {} }] }, {
    registry, toolContext: { ...createRunContext({ taskType: "chat" }), source }, input: {},
  })).rejects.toThrow("policy_denied");
  expect(http).not.toHaveBeenCalled();
});

it("SDK适配不能绕过拒绝策略", async () => {
  const http = vi.fn(async () => 1);
  const registry = createToolRegistry({ hooks: async () => ({ kind: "deny", reason_code: "policy_denied" }) });
  registry.registerTool({ name: "read", description: "读取", riskLevel: "low", inputSchema: z.object({}), execute: http });
  const sdk = registry.toSdkTools(createRunContext({ taskType: "chat" }));
  await expect(sdk.read.execute!({}, { toolCallId: "call", messages: [] })).rejects.toThrow("policy_denied");
  expect(http).not.toHaveBeenCalled();
});

it("未获批高风险工具不会展示给模型", () => {
  const registry = createToolRegistry();
  registry.registerTool({ name: "executeApprovedGovernance", description: "受控执行", riskLevel: "high", execute: async () => 1 });
  expect(registry.toSdkTools(createRunContext({ taskType: "chat" }))).toEqual({});
});
