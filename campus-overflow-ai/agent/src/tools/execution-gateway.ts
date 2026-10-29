import { checkHook, checkInvocation, checkPublicOutput } from "../security/hooks.js";
import type { GatewayContext, GatewayOptions, HookStage } from "../security/contracts.js";

/** 计划、SDK、MCP和受控执行器共用；策略失败永远不降级为放行。 */
export const executeThroughGateway = async <T>(options: {
  name: string; risk: string; input: unknown; context: GatewayContext;
  validate?: (input: unknown) => unknown; execute: (input: unknown) => Promise<T>;
} & GatewayOptions): Promise<T> => {
  const { context, name, hooks } = options;
  const input = options.validate ? options.validate(options.input) : structuredClone(options.input);
  const stage = (stage: HookStage, value = input) => checkHook(hooks, {
    stage, toolName: name, input: value, traceId: context.traceId, source: context.source ?? "chat",
  });
  try {
    checkInvocation(options.risk, input, context);
    await stage("beforeToolCall");
    if (/^(proposeGovernance|request_governance)$/.test(name)) await stage("beforeApproval");
    if (context.source === "approved_worker") await stage("beforeApprovedExecution");
    checkInvocation(options.risk, input, context);
    const result = await options.execute(input);
    await stage("afterToolCall", result);
    checkPublicOutput(result);
    await stage("beforeOutput", result);
    return result;
  } catch (error) {
    await stage("onError", { outcome: "failed_or_unknown" });
    throw error;
  }
};
