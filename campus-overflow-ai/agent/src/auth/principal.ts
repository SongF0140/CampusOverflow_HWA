import { z } from "zod";

/** 身份只取后端已验证数据；凭证不属于可交给模型或记录器的上下文。 */
export const AgentPrincipalSchema = z.object({
  user_id: z.number().int().positive(),
  role: z.enum(["student", "teacher", "admin"]),
  status: z.literal("active"),
  identity_type: z.enum(["undergraduate", "postgraduate"]),
  assistant_cert_status: z.enum(["none", "pending", "approved", "rejected"]),
}).readonly();

export type AgentPrincipal = z.infer<typeof AgentPrincipalSchema>;
