import { expect, it, vi } from "vitest";
import { validateClaim, executeApprovedAction, validateReceipt } from "../src/tools/approved-actions.js";
import { createGovernanceWorkerClient } from "../src/governance-worker-client.js";

const requestId = "00000000-0000-4000-8000-000000000001";
const executionId = "00000000-0000-4000-8000-000000000002";
// 哈希由后端Python规范序列化生成，验证Unicode和字段排序跨语言一致。
const claim = { request_id: requestId, execution_id: executionId, case_id: 3, approved_by: 4,
  lease: "opaque-private-task-lease", lease_epoch: 1, trace_id: "trace",
  args_hash: "19eaef2ced99a0b78cda34d9e5b0d2f6f36af06bb9b7c8c74fb84b4b191e4f51",
  frozen_call: { request_id: requestId, requester_id: 1, expected_version: "a".repeat(64), target_type: "question" as const,
    target_id: 2, action: "hide" as const, reason: "人工批准", duration_days: null,
    contract: "approval-v2" as const, tool_name: "executeApprovedGovernance" as const } };

it("后端规范哈希一致，改参数拒绝", () => {
  expect(validateClaim(claim)).toEqual(claim);
  expect(() => validateClaim({ ...claim, frozen_call: { ...claim.frozen_call, target_id: 9 } })).toThrow("approval_binding_mismatch");
});
it("非worker及未绑定调用零执行", async () => {
  const call = vi.fn();
  await expect(executeApprovedAction(claim, call, { source: "chat", traceId: "trace" })).rejects.toThrow();
  expect(call).not.toHaveBeenCalled();
});
it("回执错配不能进入成功证据", () => {
  expect(() => validateReceipt({ executed: true, execution_id: executionId }, claim)).toThrow();
});
it("缺少独立凭证不发HTTP", async () => {
  const http = vi.fn();
  const client = createGovernanceWorkerClient({ baseUrl: "http://backend", token: "service", executorToken: "service", fetchImpl: http });
  await expect(client.claim()).rejects.toThrow("executor_not_configured");
  expect(http).not.toHaveBeenCalled();
});
