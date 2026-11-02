import { timingSafeEqual } from "node:crypto";

export const checkWorkflowAccess = (pathname: string, env: NodeJS.ProcessEnv, key?: string | null): Response | undefined => {
  if (pathname !== "/.well-known/workflow" && !pathname.startsWith("/.well-known/workflow/")) return;
  if (env.WORKFLOW_RUNTIME_ENABLED !== "true") return new Response("工作流入口未启用", { status: 404 });
  if (env.WORKFLOW_TARGET_WORLD === "@workflow/world-postgres") {
    const expected = env.WORKFLOW_CALLBACK_SECRET;
    if (!expected || expected.length !== 64 || !key || key.length !== expected.length
      || !timingSafeEqual(Buffer.from(key), Buffer.from(expected))) return new Response("禁止访问工作流内部入口", { status: 403 });
    return;
  }
  if (env.NODE_ENV !== "development" && env.NODE_ENV !== "test") return new Response("生产工作流尚未启用", { status: 503 });
};
