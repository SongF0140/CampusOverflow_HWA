import { expect, it } from "vitest";
import { checkWorkflowAccess } from "../src/runtime/workflow-access.js";

it.each(["/.well-known/workflow", "/.well-known/workflow/v1/flow", "/.well-known/workflow/v1/step", "/.well-known/workflow/v1/webhook/token"])("Workflow默认关闭：%s", path => {
  expect(checkWorkflowAccess(path, {})?.status).toBe(404);
});
it.each(["/health", "/agent/health", "/agent/chat", "/.well-known/workflows"])("不拦截既有接口或相似前缀：%s", path => {
  expect(checkWorkflowAccess(path, {})).toBeUndefined();
});
it("显式启用本地测试才能进入Workflow handler", () => {
  expect(checkWorkflowAccess("/.well-known/workflow/v1/flow", {
    NODE_ENV: "test", WORKFLOW_RUNTIME_ENABLED: "true",
  })).toBeUndefined();
});
it("生产不因误设开关就使用Local World提供持久执行", () => {
  expect(checkWorkflowAccess("/.well-known/workflow/v1/flow", {
    NODE_ENV: "production", WORKFLOW_RUNTIME_ENABLED: "true",
  })?.status).toBe(503);
});
it("未明确开发/测试环境时也不能放行内部入口", () => {
  expect(checkWorkflowAccess("/.well-known/workflow/v1/flow", { WORKFLOW_RUNTIME_ENABLED: "true" })?.status).toBe(503);
});
