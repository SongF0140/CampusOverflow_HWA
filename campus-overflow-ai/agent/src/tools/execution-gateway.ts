import { checkHook, checkInvocation, checkPublicOutput } from "../security/hooks.js";
import type { GatewayContext, GatewayOptions, HookStage } from "../security/contracts.js";
import { SecurityPolicyError } from "../security/contracts.js";

/** 计划、SDK、MCP和受控执行器共用；策略失败永远不降级为放行。 */
export const executeThroughGateway = async <T>(options: {
  name: string; risk: string; input: unknown; context: GatewayContext;
  validate?: (input: unknown) => unknown; execute: (input: unknown) => Promise<T>;
  hasCommittedReceipt?: (result: T) => boolean;
} & GatewayOptions): Promise<T> => {
  const { context, name, hooks } = options;
  let input: unknown;
  let outcome: "not_executed" | "result_unknown" | "executed" = "not_executed";
  const stage = (stage: HookStage, value = input) => checkHook(hooks, {
    stage, toolName: name, input: value, traceId: context.traceId, source: context.source ?? "chat",
  });
  try {
    input = options.validate ? options.validate(options.input) : structuredClone(options.input);
    checkInvocation(options.risk, input, context);
    if (options.risk !== "low" && name !== "executeApprovedGovernance") throw new SecurityPolicyError("unregistered_approved_tool");
    await stage("beforeToolCall");
    if (/^(proposeGovernance|request_governance|createPatrolCase)$/.test(name)) await stage("beforeApproval");
    if (context.source === "approved_worker") await stage("beforeApprovedExecution");
    checkInvocation(options.risk, input, context);
    outcome = "result_unknown";
    const result = await options.execute(input);
    if (options.hasCommittedReceipt?.(result)) outcome = "executed";
    await stage("afterToolCall", result);
    checkPublicOutput(result);
    await stage("beforeOutput", result);
    return result;
  } catch (error) {
    // 仅固定事件与关联标识；不记录参数、返回正文或底层异常消息。
    if (error instanceof SecurityPolicyError) console.error(JSON.stringify({
      event: "tool_security_denied", source: context.source ?? "chat", tool_name: name,
      reason_code: /^[a-z_]{1,64}$/.test(error.reasonCode) ? error.reasonCode : "policy_denied",
      trace_id: context.traceId,
    }));
    await stage("onError", { outcome });
    throw error;
  }
};
