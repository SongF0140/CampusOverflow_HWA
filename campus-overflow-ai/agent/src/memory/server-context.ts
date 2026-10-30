import { z } from "zod";
import type { TraceId } from "../types/index.js";

export const ServerMemorySchema = z.object({ version: z.number().int().nonnegative(), entries: z.array(z.object({
  id: z.uuid(), content: z.string().min(1).max(500), created_at: z.string(),
})).max(50) });
export const ServerSessionInputSchema = z.object({ title: z.string().min(1).max(36), messages: z.array(z.object({
  role: z.enum(["user", "assistant"]), text: z.string().max(20_000),
}).strict()).max(100) }).strict();
export const ServerSessionSchema = ServerSessionInputSchema.extend({ id: z.uuid(), version: z.number().int().positive(),
  import_key: z.uuid().nullable().optional(), deleted: z.boolean().optional() });
export interface PrivateContextsClient {
  memory(trace: TraceId): Promise<z.infer<typeof ServerMemorySchema>>;
  sessions(trace: TraceId): Promise<z.infer<typeof ServerSessionSchema>[]>;
  session(id: string, trace: TraceId): Promise<z.infer<typeof ServerSessionSchema>>;
  create(input: unknown, trace: TraceId): Promise<z.infer<typeof ServerSessionSchema>>;
  save(id: string, input: unknown, trace: TraceId): Promise<z.infer<typeof ServerSessionSchema>>;
  remove(id: string, version: number, trace: TraceId): Promise<unknown>;
}
