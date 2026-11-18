import type { AgentPrincipal } from "../auth/principal.js";
import type { UserInternalClient } from "../internal-client.js";
import { createChildRegistry } from "../agents/controller.js";
import { qaSnapshotSlots } from "../knowledge/qa-snapshot.js";
import { ragRuntime } from "../knowledge/rag/runtime.js";
import { readMainRules } from "../memory/main-context.js";
import { createWebTools } from "../web/tools.js";
import { ensureBuiltinTools } from "./index.js";
import { createToolRegistry } from "./registry.js";
import { createCourseContextTools } from "./course-context.js";
import { createRoleActionTools } from "./role-actions.js";
import { createSearchKnowledgeTool } from "./search-knowledge.js";

/** 快照读取默认关闭；开启后只用于出候选 id，最终可见性由后端复核 */
const getQaSnapshot = () =>
  process.env.QA_SNAPSHOT_READ_ENABLED === "true" ? qaSnapshotSlots.getActive() : undefined;

/** 统一为所有端装配公共AgentTool；请求闭包隔离，角色继承和任务白名单分别裁剪。 */
export const createRequestTools = (client: UserInternalClient, principal: AgentPrincipal, courseId?: number,
  webOptions?: Parameters<typeof createWebTools>[1]) => {
  const base = createToolRegistry();
  ensureBuiltinTools(client, base, { getQaSnapshot });
  // RAG 工具默认关闭；课程范围在闭包里绑定，模型不能通过参数换课程。
  const ragTools = courseId !== undefined && process.env.RAG_ENABLED === "true"
    ? [createSearchKnowledgeTool(
      ragRuntime.getIndex,
      courseId,
      context => client.fetchTrustedTags(courseId, context.traceId),
    )]
    : [];
  const tools = [...createCourseContextTools(client, courseId), ...ragTools,
    ...createRoleActionTools(client, principal), ...createWebTools(principal, webOptions)];
  for (const tool of tools) base.registerTool(tool);
  return createChildRegistry(base, () => readMainRules(process.env.MAIN_AGENT_RULES_PATH), principal);
};
