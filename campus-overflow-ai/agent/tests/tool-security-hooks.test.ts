import { expect, it, vi } from "vitest";
import { z } from "zod";
import { createToolRegistry } from "../src/tools/registry.js";
import { createRunContext } from "../src/observability/run-context.js";
import { McpToolRegistry } from "../src/mcp/registry.js";

it.each(["chat", "patrol", "mcp", "approved_worker"] as const)("同一拒绝策略阻断 %s 且零业务调用", async source => {
  const execute = vi.fn(async () => ({ ok: true }));
  const registry = createToolRegistry({ hooks: async () => ({ kind: "deny", reason_code: "policy_denied" }) });
  registry.registerTool({ name: "read", description: "读取", riskLevel: "low", inputSchema: z.object({}), execute });
  await expect(registry.getTool("read")!.execute!({}, { ...createRunContext({ taskType: "chat" }), source })).rejects.toThrow("policy_denied");
  expect(execute).not.toHaveBeenCalled();
});

it("策略异常失败关闭，且错误回调不能放行", async () => {
  const execute = vi.fn(async () => 1);
  const registry = createToolRegistry({ hooks: async () => { throw new Error("秘密配置"); } });
  registry.registerTool({ name: "read", description: "读取", riskLevel: "low", execute });
  await expect(registry.getTool("read")!.execute!({}, createRunContext({ taskType: "chat" }))).rejects.toThrow("hook_failed");
  expect(execute).not.toHaveBeenCalled();
});

it("MCP注册表同样经过网关", async () => {
  const execute = vi.fn(async () => 1);
  const registry = new McpToolRegistry({ hooks: async () => ({ kind: "deny", reason_code: "policy_denied" }) });
  registry.registerTool({ name: "read", description: "读取", scope: "read", inputSchema: {}, validate: () => ({}), execute });
  await expect(registry.getTool("read")!.execute({}, { clientName: "test", traceId: "t", signal: new AbortController().signal })).rejects.toThrow("policy_denied");
  expect(execute).not.toHaveBeenCalled();
});

it("策略不能修改获准调用参数", async () => {
  const execute = vi.fn(async (input: unknown) => input);
  const registry = createToolRegistry({ hooks: async event => {
    if (event.stage === "beforeToolCall") (event.input as Record<string, unknown>).id = 2;
    return { kind: "allow" };
  } });
  registry.registerTool({ name: "read", description: "读取", riskLevel: "low", execute });
  await expect(registry.getTool("read")!.execute!({ id: 1 }, createRunContext({ taskType: "chat" }))).rejects.toThrow("hook_failed");
  expect(execute).not.toHaveBeenCalled();
});
