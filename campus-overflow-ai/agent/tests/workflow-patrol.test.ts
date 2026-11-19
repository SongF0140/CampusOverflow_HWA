import { afterEach, expect, it, vi } from "vitest";
const { request, dispatch, reconcile } = vi.hoisted(() => ({ request: vi.fn(), dispatch: vi.fn(), reconcile: vi.fn() }));
vi.mock("../src/workflow-client.js", async original => ({ ...await original<typeof import("../src/workflow-client.js")>(), createWorkflowClient: () => ({ request }) }));
vi.mock("../src/workflow-dispatch.js", () => ({ dispatchGovernanceTask: dispatch, resumeUnboundGovernanceTasks: reconcile }));
import { runWorkflowPatrol } from "../src/scheduler/workflow-patrol.js";
import { WorkflowApiError } from "../src/workflow-client.js";
afterEach(() => vi.resetAllMocks());
it("多页逐页处理和确认，根对账失败不阻塞业务发现", async () => {
  reconcile.mockRejectedValue(new Error("world_down"));
  request.mockResolvedValueOnce({ revision: 0, items: [{ target_type: "question", target_id: 1 }], has_more: true })
    .mockResolvedValueOnce({ revision: 1 })
    .mockResolvedValueOnce({ revision: 1, items: [{ target_type: "answer", target_id: 2 }], has_more: false })
    .mockResolvedValueOnce({ revision: 2 });
  const result = await runWorkflowPatrol();
  expect(dispatch).toHaveBeenCalledTimes(2); expect(result.scanned).toBe(2);
  expect(request).toHaveBeenCalledWith("/scan/page", { revision: 0 });
  expect(request).toHaveBeenCalledWith("/scan/page", { revision: 1 });
});
it("页内启动失败时不确认，下一次仍可重试原页", async () => {
  request.mockResolvedValue({ revision: 3, items: [{ target_type: "question", target_id: 1 }], has_more: true });
  dispatch.mockRejectedValue(new Error("backend_down"));
  expect((await runWorkflowPatrol()).failed).toBe(1);
  expect(request).toHaveBeenCalledTimes(1);
});

it.each([new WorkflowApiError(409), new Error("workflow_http_409")])("未知409不得确认页：%s", async error => {
  request.mockResolvedValue({ revision: 3, items: [{ target_type: "question", target_id: 1 }], has_more: true });
  dispatch.mockRejectedValue(error);
  expect(await runWorkflowPatrol()).toMatchObject({ skipped: 0, failed: 1 });
  expect(request).toHaveBeenCalledTimes(1);
});

it("仅明确不可巡检原因码可跳过并确认", async () => {
  request.mockResolvedValue({ revision: 3, items: [{ target_type: "question", target_id: 1 }], has_more: false });
  dispatch.mockRejectedValue(new WorkflowApiError(409, "patrol_target_unavailable"));
  expect(await runWorkflowPatrol()).toMatchObject({ skipped: 1, failed: 0 });
  expect(request).toHaveBeenCalledWith("/scan/page", { revision: 3 });
});

it("混合页存在未知409时整页保留", async () => {
  request.mockResolvedValue({ revision: 4, items: [{ target_type: "question", target_id: 1 }, { target_type: "answer", target_id: 2 }], has_more: false });
  dispatch.mockRejectedValueOnce(new WorkflowApiError(409, "patrol_target_unavailable")).mockRejectedValueOnce(new WorkflowApiError(409));
  expect(await runWorkflowPatrol()).toMatchObject({ skipped: 1, failed: 1 });
  expect(request).toHaveBeenCalledTimes(1);
});
