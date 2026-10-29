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

const CaseState = z.enum(["pending", "agent_proposed", "manager_directed", "executed", "rejected"]);
export const ApprovalWaitSchema = z.object({
  request_id: z.uuid(), case_id: z.number().int().positive(),
  state: z.enum(["waiting", "completed", "rejected", "expired", "cancelled"]),
  case_status: CaseState,
  executed: z.boolean(), expires_at: z.string().nullable(),
  result: z.object({ case_status: CaseState, resolution: z.string().nullable(), executed: z.boolean() }).strict().nullable(),
  agent_run_id: z.string(), trace_id: z.string(),
}).superRefine((value, context) => {
  if (value.executed !== (value.case_status === "executed")
    || (value.state === "completed" && (!value.executed || !value.result?.executed || value.result.case_status !== "executed"))
    || (value.state === "rejected" && value.case_status !== "rejected")
    || (value.state === "waiting" && value.result !== null)
    || (value.state !== "waiting" && value.result === null)) {
    context.addIssue({ code: "custom", message: "审批结果状态不一致" });
  }
});
export type ApprovalWait = z.infer<typeof ApprovalWaitSchema>;

export const ClassChangeInputSchema = z.object({ request_id: z.uuid().transform(value => value.toLowerCase()), course_id: z.number().int().positive(),
  student_ids: z.array(z.number().int().positive()).min(1).max(50), action: z.enum(["add", "remove"]) }).strict();
export type ClassChangeInput = z.infer<typeof ClassChangeInputSchema>;
export const ClassChangeResultSchema = z.object({ request_id: z.uuid(), course_id: z.number().int().positive(),
  course_name: z.string(), action: z.enum(["add", "remove"]),
  status: z.enum(["pending", "executed", "expired", "cancelled"]), executed: z.boolean(), requires_confirmation: z.boolean(),
  expires_at: z.string(), trace_id: z.string(),
  students: z.array(z.object({ user_id: z.number().int().positive(), username: z.string(),
    role: z.literal("student"), status: z.literal("active"), joined: z.boolean() })).max(50),
}).superRefine((data, context) => {
  if (data.executed !== (data.status === "executed") || data.requires_confirmation !== (data.status === "pending")) {
    context.addIssue({ code: "custom", message: "名单申请状态不一致" });
  }
});
export type ClassChangeResult = z.infer<typeof ClassChangeResultSchema>;
