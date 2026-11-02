import { afterEach, beforeEach, expect, it, vi } from "vitest";

const { request, start } = vi.hoisted(() => ({ request: vi.fn(), start: vi.fn() }));
vi.mock("workflow/api", () => ({ start }));
vi.mock("../src/workflows/governance.js", () => ({ governanceWorkflow: vi.fn() }));
vi.mock("../src/workflow-client.js", async importOriginal => ({
  ...await importOriginal<typeof import("../src/workflow-client.js")>(), createWorkflowClient: () => ({ request }),
}));
import { dispatchGovernanceTask, resumeUnboundGovernanceTasks } from "../src/workflow-dispatch.js";

const root = { task_id: "00000000-0000-4000-8000-000000000001", trace_id: "t", status: "active", workflow_run_id: null };
const target = { target_type: "question", target_id: 1 };
beforeEach(() => {
  vi.stubEnv("GOVERNANCE_WORKFLOW_ENABLED", "true"); vi.stubEnv("WORKFLOW_RUNTIME_ENABLED", "true");
});
afterEach(() => { vi.resetAllMocks(); vi.unstubAllEnvs(); });
it("默认关闭时零请求零启动", async () => {
  vi.stubEnv("GOVERNANCE_WORKFLOW_ENABLED", "false");
  await expect(dispatchGovernanceTask(target)).rejects.toThrow("workflow_dispatch_disabled");
  expect(request).not.toHaveBeenCalled(); expect(start).not.toHaveBeenCalled();
});
it("根绑定后不因重复巡检重启轮数", async () => {
  request.mockResolvedValue({ ...root, workflow_run_id: "wrun_existing" });
  await dispatchGovernanceTask(target); expect(start).not.toHaveBeenCalled();
});
it("start响应丢失但已绑定时，下轮读取原根而不另起治理", async () => {
  request.mockResolvedValueOnce(root).mockResolvedValueOnce({ ...root, workflow_run_id: "wrun_existing" });
  start.mockRejectedValueOnce(new Error("response_lost"));
  await expect(dispatchGovernanceTask(target)).rejects.toThrow();
  await dispatchGovernanceTask(target); expect(start).toHaveBeenCalledTimes(1);
});
it("补偿只启动后端列出的未绑定根任务", async () => {
  request.mockResolvedValue({ items: [root] }); await resumeUnboundGovernanceTasks();
  expect(start).toHaveBeenCalledTimes(1); expect(start.mock.calls[0]?.[1]).toEqual([root.task_id]);
});
