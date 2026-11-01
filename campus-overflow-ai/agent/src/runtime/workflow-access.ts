/** WF-02仅开放显式启用的本地运行；生产World与路由保护验收前不能启用。 */
export const checkWorkflowAccess = (pathname: string, env: NodeJS.ProcessEnv): Response | undefined => {
  if (pathname !== "/.well-known/workflow" && !pathname.startsWith("/.well-known/workflow/")) return;
  if (env.WORKFLOW_RUNTIME_ENABLED !== "true") return new Response("工作流入口未启用", { status: 404 });
  if (env.NODE_ENV !== "development" && env.NODE_ENV !== "test") return new Response("生产工作流尚未启用", { status: 503 });
};
