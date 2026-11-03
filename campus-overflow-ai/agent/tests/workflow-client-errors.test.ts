import { afterEach, expect, it, vi } from "vitest";
import { createWorkflowClient, WorkflowApiError } from "../src/workflow-client.js";
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

it.each([
  ["", { code: 409, reason_code: "patrol_target_unavailable" }, "patrol_target_unavailable"],
  ["", { code: 409, reason_code: "target_changed" }, undefined],
  ["", { code: 409, message: "目标不存在或当前不可巡检" }, undefined],
  ["/task/proposals", { code: 409, reason_code: "patrol_target_unavailable" }, undefined],
] as const)("只在根创建接口识别白名单原因码 %s %j", async (path, body, expected) => {
  vi.stubEnv("AGENT_SERVICE_TOKEN", "test-only-service-token");
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(body), { status: 409 })));
  const error = await createWorkflowClient().request(path, {}).catch(e => e);
  expect(error).toBeInstanceOf(WorkflowApiError);
  expect(error.reasonCode).toBe(expected);
  expect(error.message).toBe("workflow_http_409");
});
