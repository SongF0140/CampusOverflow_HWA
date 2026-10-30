import { expect, it, vi } from "vitest";
import { runGovernanceJob } from "../src/scheduler/governance-executor.js";

const receipt = { executed: true };
const claim = { execution_id: "job" };
it("恢复先查回执，已执行不再调用处置", async () => {
  const client = { claim: vi.fn(async () => claim), read: vi.fn(async () => ({ executed: true, receipt })),
    execute: vi.fn(), report: vi.fn() };
  await runGovernanceJob(client);
  expect(client.execute).not.toHaveBeenCalled();
  expect(client.report).toHaveBeenCalledWith(claim, "completed");
});
it("响应丢失先核对同一任务，不重复处置", async () => {
  const client = { claim: vi.fn(async () => claim), read: vi.fn().mockResolvedValueOnce({ executed: false }).mockResolvedValue({ executed: true, receipt }),
    execute: vi.fn().mockRejectedValue(new Error("network")), report: vi.fn() };
  await runGovernanceJob(client, { wait: async () => {} });
  expect(client.execute).toHaveBeenCalledTimes(1);
  expect(client.report).toHaveBeenCalledWith(claim, "completed");
});
it("三次核对仍未知即停，不能新建动作", async () => {
  const client = { claim: vi.fn(async () => claim), read: vi.fn(async () => ({ executed: false })),
    execute: vi.fn().mockRejectedValue(new Error("timeout")), report: vi.fn() };
  await runGovernanceJob(client, { wait: async () => {} });
  expect(client.execute).toHaveBeenCalledTimes(1);
  expect(client.read).toHaveBeenCalledTimes(4);
  expect(client.report).toHaveBeenCalledWith(claim, "result_unknown");
});
