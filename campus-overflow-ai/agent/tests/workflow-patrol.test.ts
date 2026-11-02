import { afterEach, expect, it, vi } from "vitest";
const { request, dispatch, reconcile } = vi.hoisted(() => ({ request: vi.fn(), dispatch: vi.fn(), reconcile: vi.fn() }));
vi.mock("../src/workflow-client.js", () => ({ createWorkflowClient: () => ({ request }) }));
vi.mock("../src/workflow-dispatch.js", () => ({ dispatchGovernanceTask: dispatch, resumeUnboundGovernanceTasks: reconcile }));
import { runWorkflowPatrol } from "../src/scheduler/workflow-patrol.js";
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
