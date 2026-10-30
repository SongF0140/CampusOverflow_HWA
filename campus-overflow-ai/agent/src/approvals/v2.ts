import { z } from "zod";
export const GovernanceV2Schema = z.object({
  contract_version: z.literal(2), request_id: z.uuid(), case_id: z.number().int().positive(),
  status: z.enum(["pending", "approved", "executed", "rejected", "cancelled", "expired", "invalidated", "blocked"]),
  agent_run_id: z.string(), trace_id: z.string(), expires_at: z.string(),
  executed: z.boolean(), args_hash: z.string(),
  execution_state: z.string().nullable().optional(),
  frozen_call: z.object({ target_type: z.enum(["question", "answer", "comment", "user"]), target_id: z.number(),
    action: z.enum(["hide", "delete", "ban", "ban_temp", "warn"]), duration_days: z.number().nullable(),
    expected_version: z.string() }),
}).superRefine((item, context) => {
  if (item.executed !== (item.status === "executed") || item.agent_run_id !== `approval-${item.request_id}`) {
    context.addIssue({ code: "custom", message: "v2审批状态不一致" });
  }
});
