import { z } from "zod";

const VersionSchema = z.string().regex(/^[0-9a-f]{64}$/);

export const GovernanceTargetSchema = z.object({
  targetType: z.enum(["question", "answer", "comment", "user"]),
  targetId: z.number().int().positive(),
});

export const GovernanceStateSchema = z.discriminatedUnion("target_type", [
  z.object({
    target_type: z.enum(["question", "answer", "comment"]),
    target_id: z.number().int().positive(),
    current_state: z.enum(["ready", "missing", "deleted", "hidden"]),
    state_version: VersionSchema.optional(),
  }),
  z.object({
    target_type: z.literal("user"),
    target_id: z.number().int().positive(),
    current_state: z.enum(["active", "banned", "missing"]),
    state_version: VersionSchema.optional(),
  }),
]);
export type GovernanceState = z.infer<typeof GovernanceStateSchema>;

const GovernanceInputFields = z.object({
  target_type: z.enum(["question", "answer", "comment", "user"]),
  target_id: z.number().int().positive(),
  action: z.enum(["hide", "delete", "ban", "ban_temp", "warn"]),
  reason: z.string().trim().min(1).max(500),
  duration_days: z.number().int().min(1).max(30).optional(),
}).strict();

const checkAction = (input: z.infer<typeof GovernanceInputFields>, context: z.RefinementCtx) => {
  const isContentAction = input.action === "hide" || input.action === "delete";
  if (isContentAction === (input.target_type === "user")) {
    context.addIssue({ code: "custom", message: "动作与目标类型不匹配" });
  }
  if (input.action !== "ban_temp" && input.duration_days !== undefined) {
    context.addIssue({ code: "custom", message: "只有限时封禁可以指定期限" });
  }
};
export const GovernancePreviewInputSchema = GovernanceInputFields.superRefine(checkAction);
export type GovernancePreviewInput = z.infer<typeof GovernancePreviewInputSchema>;

export const GovernanceRequestInputSchema = GovernanceInputFields.extend({
  request_id: z.uuid().transform(value => value.toLowerCase()),
  expected_version: VersionSchema,
}).superRefine(checkAction);
export type GovernanceRequestInput = z.infer<typeof GovernanceRequestInputSchema>;

export const GovernanceRequestAckSchema = z.object({
  request_id: z.uuid(), case_id: z.number().int().positive(), agent_run_id: z.string().min(1).max(64),
  target_type: z.enum(["question", "answer", "comment", "user"]), target_id: z.number().int().positive(),
  action: z.enum(["hide", "delete", "ban", "ban_temp", "warn"]),
  duration_days: z.number().int().min(1).max(30).nullable().optional(),
  status: z.enum(["pending", "agent_proposed", "manager_directed", "executed", "rejected"]),
  repeat: z.boolean(),
});
export type GovernanceRequestAck = z.infer<typeof GovernanceRequestAckSchema>;
