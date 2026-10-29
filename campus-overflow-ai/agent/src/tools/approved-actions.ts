import { createHash } from "node:crypto";
import { z } from "zod";
import { executeThroughGateway } from "./execution-gateway.js";
import { SecurityPolicyError, type GatewayContext, type SecurityHooks } from "../security/contracts.js";

export const ExecutionReceiptSchema = z.object({
  execution_id: z.uuid(), request_id: z.uuid(), case_id: z.number().int().positive(), args_hash: z.string().regex(/^[a-f0-9]{64}$/),
  target_type: z.enum(["question", "answer", "comment", "user"]), target_id: z.number().int().positive(),
  action: z.enum(["hide", "delete", "warn", "ban", "ban_temp"]), approved_by: z.number().int().positive(),
  executed: z.literal(true), committed_at: z.string(), trace_id: z.string(), agent_run_id: z.string(),
}).strict();
export const ExecutionClaimSchema = z.object({
  case_id: z.number().int().positive(), approved_by: z.number().int().positive(),
  execution_id: z.uuid(), request_id: z.uuid(), lease: z.string().min(20), lease_epoch: z.number().int().positive(),
  args_hash: z.string().regex(/^[a-f0-9]{64}$/), trace_id: z.string(),
  frozen_call: z.object({ contract: z.literal("approval-v2"), tool_name: z.literal("executeApprovedGovernance"),
    request_id: z.uuid(), requester_id: z.number().int().positive(), expected_version: z.string(),
    target_type: z.enum(["question", "answer", "comment", "user"]), target_id: z.number().int().positive(),
    action: z.enum(["hide", "delete", "warn", "ban", "ban_temp"]), reason: z.string(), duration_days: z.number().nullable(),
  }).strict(),
}).strict();
export type ExecutionClaim = z.infer<typeof ExecutionClaimSchema>;
export const validateClaim = (raw: unknown): ExecutionClaim => {
  const claim = ExecutionClaimSchema.parse(raw);
  const call = claim.frozen_call;
  const canonical = JSON.stringify(Object.fromEntries(Object.entries(call).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)));
  if (call.request_id !== claim.request_id || createHash("sha256").update(canonical).digest("hex") !== claim.args_hash) {
    throw new SecurityPolicyError("approval_binding_mismatch");
  }
  return claim;
};
export const validateReceipt = (raw: unknown, claim: ExecutionClaim) => {
  const receipt = ExecutionReceiptSchema.parse(raw);
  if (receipt.execution_id !== claim.execution_id || receipt.request_id !== claim.request_id
    || receipt.case_id !== claim.case_id || receipt.approved_by !== claim.approved_by
    || receipt.args_hash !== claim.args_hash || receipt.target_type !== claim.frozen_call.target_type
    || receipt.target_id !== claim.frozen_call.target_id || receipt.action !== claim.frozen_call.action
    || receipt.trace_id !== claim.trace_id || receipt.agent_run_id !== `execution-${claim.execution_id}`) {
    throw new SecurityPolicyError("receipt_binding_mismatch");
  }
  return receipt;
};

/** 不注册模型或MCP；租约由调用闭包持有，工具参数只有execution_id。 */
export const executeApprovedAction = async (
  claim: ExecutionClaim, call: () => Promise<unknown>, context: GatewayContext, hooks?: SecurityHooks,
) => {
  validateClaim(claim);
  if (context.source !== "approved_worker" || context.approvedExecution?.executionId !== claim.execution_id
    || context.approvedExecution.argsHash !== claim.args_hash || context.approvedExecution.leaseEpoch !== claim.lease_epoch) {
    throw new SecurityPolicyError("approval_binding_mismatch");
  }
  return executeThroughGateway({ name: "executeApprovedGovernance", risk: "high", hooks,
    input: { execution_id: claim.execution_id }, context, execute: async () => validateReceipt(await call(), claim),
  });
};
