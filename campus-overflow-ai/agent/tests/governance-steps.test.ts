import { afterEach, expect, it, vi } from "vitest";
const { request } = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("../src/workflow-client.js", async original => ({
  ...await original<typeof import("../src/workflow-client.js")>(), createWorkflowClient: () => ({ request }),
}));
import { proposeGovernanceAction, readGovernanceApproval } from "../src/workflows/governance-steps.js";
const id = "00000000-0000-4000-8000-000000000001";
afterEach(() => { vi.resetAllMocks(); vi.useRealTimers(); });
it("冻结使用输入观察版本，不再读取新版本替换模型依据", async () => {
  request.mockImplementation(async (_path, body) => ({ request_id: body.request_id }));
  await proposeGovernanceAction(id, 1, 0, { action: "hide", reason: "复核", duration_days: null }, {
    task_id: id, observation_ref: "obs-1", excerpt: "", title: "", body: "正文", content_complete: true,
    content: { current_state: "ready", state_version: "a".repeat(64) }, author: null,
  });
  expect(request).toHaveBeenCalledTimes(1);
  expect(request.mock.calls[0]?.[1]).toMatchObject({ expected_version: "a".repeat(64), expected_content_version: "a".repeat(64) });
});
it("查询审批即使耗时很长也不占活动预算", async () => {
  vi.useFakeTimers(); request.mockImplementation(async () => {
    vi.advanceTimersByTime(180_000); return { request_id: id, status: "pending" };
  });
  expect((await readGovernanceApproval(id, id)).active_ms).toBe(0);
});
