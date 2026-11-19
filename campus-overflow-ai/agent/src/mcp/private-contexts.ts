import { z } from "zod";
import type { UserInternalClient } from "../internal-client.js";
import { ServerSessionInputSchema } from "../memory/server-context.js";
import { asTraceId } from "../types/index.js";
import { McpToolRegistry, zodValidator } from "./registry.js";

/** 中台只访问密钥映射客户端自己的会话；没有管理员memory工具。 */
export const ensurePrivateContextMcpTools = (registry: McpToolRegistry, clientForName: (name: string) => UserInternalClient) => {
  for (const [name, schema, scope] of [
    ["list_private_sessions", z.object({}).strict(), "admin:query"],
    ["read_private_session", z.object({ session_id: z.uuid() }).strict(), "admin:query"],
    ["create_private_session", ServerSessionInputSchema, "admin:act"],
    ["update_private_session", ServerSessionInputSchema.extend({ session_id: z.uuid(), version: z.number().int().positive() }), "admin:act"],
    ["delete_private_session", z.object({ session_id: z.uuid(), version: z.number().int().positive() }).strict(), "admin:act"],
  ] as const) registry.registerTool({ name, scope, privateContext: true,
    description: "管理本中台客户端及映射账号的私人会话，不能访问管理员私人目录或其他客户端",
    inputSchema: z.toJSONSchema(schema), validate: zodValidator(schema), execute: async (input, context) => {
      const client = clientForName(context.clientName);
      const trace = asTraceId(context.traceId);
      const principal = await client.resolvePrincipal(trace);
      if (principal.role !== "admin" || principal.status !== "active" || !client.privateContexts) throw new Error("私人会话不可用");
      if (name === "list_private_sessions") return client.privateContexts.sessions(trace);
      if (name === "create_private_session") return client.privateContexts.create(input, trace);
      const id = z.uuid().parse(input.session_id);
      if (name === "read_private_session") return client.privateContexts.session(id, trace);
      if (name === "delete_private_session") return client.privateContexts.remove(id, z.number().parse(input.version), trace);
      const { session_id: _id, ...body } = input;
      return client.privateContexts.save(id, body, trace);
    } });
};
