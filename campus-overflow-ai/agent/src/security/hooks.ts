import { SecurityPolicyError, type GatewayContext, type HookEvent, type SecurityHooks } from "./contracts.js";

const freeze = (value: unknown): unknown => {
  if (value && typeof value === "object") {
    for (const item of Object.values(value)) freeze(item);
    Object.freeze(value);
  }
  return value;
};

/** hook只得到冻结的脱离副本，不能替换已校验参数或取得凭证上下文。 */
export const checkHook = async (hooks: SecurityHooks | undefined, event: HookEvent): Promise<void> => {
  if (!hooks) return;
  let decision;
  try { decision = await hooks(freeze(structuredClone(event)) as HookEvent); }
  catch { throw new SecurityPolicyError("hook_failed"); }
  if (!decision || decision.kind !== "allow") {
    throw new SecurityPolicyError(decision?.reason_code ?? "policy_denied");
  }
};

export const checkInvocation = (risk: string, input: unknown, context: GatewayContext): void => {
  if (context.signal?.aborted) throw new SecurityPolicyError("cancelled");
  if (context.principal && context.principal.status !== "active") throw new SecurityPolicyError("identity_inactive");
  if (risk !== "low" && (context.source !== "approved_worker" || !context.approvedExecution)) {
    throw new SecurityPolicyError("approval_required");
  }
  if (input && typeof input === "object" && Object.keys(input).some(key =>
    ["role", "principal", "operator", "operator_id", "actor", "user_id"].includes(key))) {
    throw new SecurityPolicyError("identity_argument_forbidden");
  }
};

export const checkPublicOutput = (result: unknown): void => {
  if (!result || typeof result !== "object") return;
  for (const [key, value] of Object.entries(result)) {
    if (/^(authorization|password|password_hash|lease|lease_hash|executor_token|service_token|api_key)$/i.test(key)) {
      throw new SecurityPolicyError("credential_output_forbidden");
    }
    checkPublicOutput(value);
  }
};
