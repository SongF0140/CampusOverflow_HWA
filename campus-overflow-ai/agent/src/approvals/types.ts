import { z } from "zod";

export const GovernanceTargetSchema = z.object({
  targetType: z.enum(["question", "answer", "comment", "user"]),
  targetId: z.number().int().positive(),
});

export const GovernanceStateSchema = z.discriminatedUnion("target_type", [
  z.object({
    target_type: z.enum(["question", "answer", "comment"]),
    target_id: z.number().int().positive(),
    current_state: z.enum(["ready", "missing", "deleted", "hidden"]),
  }),
  z.object({
    target_type: z.literal("user"),
    target_id: z.number().int().positive(),
    current_state: z.enum(["active", "banned", "missing"]),
  }),
]);
export type GovernanceState = z.infer<typeof GovernanceStateSchema>;

export const GovernancePreviewInputSchema = z.object({
  target_type: z.enum(["question", "answer", "comment", "user"]),
  target_id: z.number().int().positive(),
  action: z.enum(["hide", "delete", "ban", "ban_temp", "warn"]),
  reason: z.string().trim().min(1).max(500),
  duration_days: z.number().int().min(1).max(30).optional(),
}).strict().superRefine((input, context) => {
  const isContentAction = input.action === "hide" || input.action === "delete";
  if (isContentAction === (input.target_type === "user")) {
    context.addIssue({ code: "custom", message: "动作与目标类型不匹配" });
  }
  if (input.action !== "ban_temp" && input.duration_days !== undefined) {
    context.addIssue({ code: "custom", message: "只有限时封禁可以指定期限" });
  }
});
export type GovernancePreviewInput = z.infer<typeof GovernancePreviewInputSchema>;
