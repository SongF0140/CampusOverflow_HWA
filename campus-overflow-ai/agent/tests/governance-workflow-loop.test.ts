import { expect, it, vi } from "vitest";
import { runGovernanceRounds, GovernanceRetryError, type GovernanceRoundDeps } from "../src/loop/governance-workflow-loop.js";

const task = { task_id: "00000000-0000-4000-8000-000000000001", trace_id: "trace" };
const deps = (): GovernanceRoundDeps => {
  let obs = 0;
  return { observe: vi.fn(async () => ({ observation_ref: `obs-${++obs}`, content_complete: true })),
    plan: vi.fn(async () => ({ actions: Array.from({ length: 3 }, () => ({ action: "hide", reason: "复核", duration_days: null })) })),
    propose: vi.fn(async (_r, index) => `request-${index}`),
    approval: vi.fn(async () => "approved"), execute: vi.fn(async () => "executed"),
    evaluate: vi.fn(async observation => ({ decision: "continue", progress: true, evidence_refs: [observation.observation_ref] })),
    wait: vi.fn(async () => undefined), finish: vi.fn(async () => undefined), activeMs: () => 0 };
};
it("5轮每轮3动作只增加5轮，预算跨轮累计", async () => {
  const d = deps(); const result = await runGovernanceRounds(task, d);
  expect(result.reason).toBe("round_limit"); expect(result.checkpoint.round).toBe(5);
  expect(d.propose).toHaveBeenCalledTimes(15); expect(result.tool_calls).toBe(40);
});
it("已知未执行冲突反馈模型并进入下一轮，不越过五轮", async () => {
  const d = deps();
  d.propose = vi.fn(async () => { throw new GovernanceRetryError("target_changed"); });
  const result = await runGovernanceRounds(task, d);
  expect(result.reason).toBe("round_limit"); expect(result.checkpoint.round).toBe(5);
  expect(d.plan).toHaveBeenCalledTimes(5); expect(d.execute).not.toHaveBeenCalled();
  expect(vi.mocked(d.plan).mock.calls[1]?.[2]?.code).toBe("target_changed");
});
it("申请使用本轮模型观察，观察不完整不调用模型", async () => {
  const d = deps(); d.evaluate = async o => ({ decision: "goal_reached", progress: true, evidence_refs: [o.observation_ref] });
  await runGovernanceRounds(task, d);
  expect(vi.mocked(d.propose).mock.calls[0]?.[3]).toEqual(vi.mocked(d.observe).mock.results[0]?.value && await vi.mocked(d.observe).mock.results[0]!.value);
  const e = deps(); e.observe = async () => ({ observation_ref: "obs-incomplete", content_complete: false });
  expect((await runGovernanceRounds(task, e)).reason).toBe("observation_incomplete");
  expect(e.plan).not.toHaveBeenCalled();
});
it("失败反馈保留本轮已经执行的动作，避免模型盲目重复", async () => {
  const d = deps();
  d.propose = vi.fn(async (_round, index) => {
    if (index === 1) throw new GovernanceRetryError("target_changed");
    return "request-one";
  });
  await runGovernanceRounds(task, d);
  expect(vi.mocked(d.plan).mock.calls[1]?.[2]).toMatchObject({
    code: "target_changed", previous_round: 1, completed_actions: ["hide"], attempted_action: "hide",
  });
});
it("后端根任务元数据不能混入严格检查点", async () => {
  const root = { ...task, status: "active", workflow_run_id: "wrun_test" };
  const d = deps(); d.plan = async () => ({ actions: [] });
  d.evaluate = async o => ({ decision: "goal_reached", progress: true, evidence_refs: [o.observation_ref] });
  expect((await runGovernanceRounds(root, d)).reason).toBe("goal_reached");
});
it("等待审批和核对未知结果仍属于原轮，不新增申请", async () => {
  const d = deps(); d.plan = vi.fn(async () => ({ actions: [{ action: "hide", reason: "复核", duration_days: null }] }));
  d.approval = vi.fn().mockResolvedValueOnce("pending").mockResolvedValue("approved");
  d.execute = vi.fn().mockResolvedValueOnce("unknown").mockResolvedValue("executed");
  d.evaluate = async o => ({ decision: "goal_reached", progress: true, evidence_refs: [o.observation_ref] });
  const result = await runGovernanceRounds(task, d);
  expect(result.checkpoint.round).toBe(1); expect(d.propose).toHaveBeenCalledTimes(1);
  expect(d.execute).toHaveBeenCalledTimes(2); expect(d.wait).toHaveBeenCalledTimes(2);
});
it("连续两轮无进展转人工，活动时间耗尽不再执行", async () => {
  const d = deps(); d.evaluate = async o => ({ decision: "continue", progress: false, evidence_refs: [o.observation_ref] });
  expect((await runGovernanceRounds(task, d)).reason).toBe("no_progress");
  const e = deps(); e.activeMs = () => 120_001;
  expect((await runGovernanceRounds(task, e)).reason).toBe("active_time_budget");
  expect(e.execute).not.toHaveBeenCalled();
});
