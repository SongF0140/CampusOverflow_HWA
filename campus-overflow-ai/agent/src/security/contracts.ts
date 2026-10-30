export type InvocationSource = "chat" | "patrol" | "mcp" | "approved_worker";
export type HookStage = "beforePlan" | "beforeToolCall" | "beforeApproval" | "beforeApprovedExecution"
  | "afterToolCall" | "beforeResume" | "beforeOutput" | "onError";
export type GateDecision = { kind: "allow" } | { kind: "deny" | "require_approval"; reason_code: string };
export interface HookEvent {
  readonly stage: HookStage;
  readonly source: InvocationSource;
  readonly toolName: string;
  readonly input: unknown;
  readonly traceId: string;
}
export type SecurityHooks = (event: HookEvent) => Promise<GateDecision>;
export interface GatewayOptions { hooks?: SecurityHooks }
export interface GatewayContext {
  source?: InvocationSource;
  signal?: AbortSignal;
  traceId: string;
  principal?: { user_id: number; role: string; status: string };
  approvedExecution?: { executionId: string; argsHash: string; leaseEpoch: number };
}
export class SecurityPolicyError extends Error {
  constructor(readonly reasonCode: string) { super(`安全检查拒绝：${reasonCode}`); this.name = "SecurityPolicyError"; }
}
