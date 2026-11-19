import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  createGovernanceLoopState, GovernanceLoopStateSchema, MAX_GOVERNANCE_ROUNDS,
  transitionGovernanceLoop, type GovernanceLoopState,
} from "../src/loop/governance-loop-state.js";

const createState = () => createGovernanceLoopState({ task_id: randomUUID(), trace_id: "trace-governance" });
const evaluate = (state: GovernanceLoopState, decision: "continue" | "goal_reached" | "handoff" = "continue", progress = true) =>
  transitionGovernanceLoop(state, {
    type: "evaluate", round: state.round, revision: state.revision,
    observation_refs: [`observation-${state.round}`],
    assessment: { decision, progress, evidence_refs: [`observation-${state.round}`] },
  });
const waitForApproval = (state: GovernanceLoopState, actionRef = "request-1") => transitionGovernanceLoop(state, {
  type: "wait_approval", round: state.round, revision: state.revision, action_ref: actionRef,
});

describe("治理完整 loop 计轮", () => {
  it("最多五轮，第五轮未达目标转人工，不产生第六轮", () => {
    let state = createState();
    expect(MAX_GOVERNANCE_ROUNDS).toBe(5);
    for (let round = 1; round <= 5; round += 1) {
      expect(state).toMatchObject({ round, phase: "acting" });
      state = evaluate(state);
    }
    expect(state).toMatchObject({ round: 5, phase: "needs_human", stop_reason: "round_limit" });
    expect(() => evaluate(state)).toThrow();
  });

  it("第五轮仍可完成并如实报告目标达成", () => {
    let state = createState();
    for (let i = 0; i < 4; i += 1) state = evaluate(state);
    expect(evaluate(state, "goal_reached")).toMatchObject({ round: 5, phase: "completed", stop_reason: "goal_reached" });
  });

  it("一轮内六个动作的等待、核对均不叠加轮数", () => {
    let state = createState();
    for (let action = 1; action <= 6; action += 1) {
      const actionRef = `request-${action}`;
      state = waitForApproval(state, actionRef);
      state = transitionGovernanceLoop(state, {
        type: "approval_resolved", round: state.round, revision: state.revision, action_ref: actionRef, outcome: "approved",
      });
      state = transitionGovernanceLoop(state, {
        type: "result_unknown", round: state.round, revision: state.revision, action_ref: actionRef,
      });
      state = transitionGovernanceLoop(state, {
        type: "result_verified", round: state.round, revision: state.revision, action_ref: actionRef, outcome: "executed",
      });
      expect(state).toMatchObject({ round: 1, phase: "acting" });
    }
    expect(evaluate(state)).toMatchObject({ round: 2, phase: "acting" });
  });

  it("连续两轮无进展提前转人工", () => {
    const state = evaluate(evaluate(createState(), "continue", false), "continue", false);
    expect(state).toMatchObject({ round: 2, phase: "needs_human", stop_reason: "no_progress", consecutive_no_progress: 2 });
  });

  it("有进展清除无进展计数，等待不改变计数", () => {
    let state = evaluate(createState(), "continue", false);
    expect(waitForApproval(state).consecutive_no_progress).toBe(1);
    state = evaluate(state);
    expect(state).toMatchObject({ round: 3, consecutive_no_progress: 0 });
    expect(evaluate(state, "continue", false)).toMatchObject({ round: 4, phase: "acting", consecutive_no_progress: 1 });
  });

  it("模型主动交接结束当前轮", () => {
    expect(evaluate(createState(), "handoff")).toMatchObject({ round: 1, phase: "needs_human", stop_reason: "model_handoff" });
  });
});

describe("等待与未知结果", () => {
  it.each(["denied", "expired", "cancelled"] as const)("审批%s终止流程，不继续生成动作", outcome => {
    const state = waitForApproval(createState());
    expect(transitionGovernanceLoop(state, {
      type: "approval_resolved", round: state.round, revision: state.revision, action_ref: "request-1", outcome,
    })).toMatchObject({ round: 1, phase: "needs_human", stop_reason: `approval_${outcome}` });
  });

  it("等待期间不能评估、再次申请或核对另一个动作", () => {
    const state = waitForApproval(createState());
    expect(() => evaluate(state)).toThrow();
    expect(() => waitForApproval(state, "request-2")).toThrow();
    expect(() => transitionGovernanceLoop(state, {
      type: "approval_resolved", round: state.round, revision: state.revision, action_ref: "request-2", outcome: "approved",
    })).toThrow();
  });

  it("未知结果只核对原动作，不能评估或发起替代审批", () => {
    const state = transitionGovernanceLoop(createState(), { type: "result_unknown", round: 1, revision: 0, action_ref: "execution-1" });
    expect(() => evaluate(state, "goal_reached")).toThrow();
    expect(() => waitForApproval(state)).toThrow();
    expect(() => transitionGovernanceLoop(state, {
      type: "result_verified", round: 1, revision: state.revision, action_ref: "execution-2", outcome: "executed",
    })).toThrow();
  });

  it.each(["executed", "not_executed"] as const)("确定核对为%s后仍在原轮，不能凭回执直接报告目标达成", outcome => {
    const state = transitionGovernanceLoop(createState(), { type: "result_unknown", round: 1, revision: 0, action_ref: "execution-1" });
    expect(transitionGovernanceLoop(state, {
      type: "result_verified", round: 1, revision: state.revision, action_ref: "execution-1", outcome,
    })).toMatchObject({ round: 1, phase: "acting", stop_reason: null, pending_ref: null });
  });

  it("第五轮的审批恢复不会重置或增加轮数", () => {
    let state = createState();
    for (let i = 0; i < 4; i += 1) state = evaluate(state);
    state = GovernanceLoopStateSchema.parse(JSON.parse(JSON.stringify(waitForApproval(state))));
    state = transitionGovernanceLoop(state, {
      type: "approval_resolved", round: 5, revision: state.revision, action_ref: "request-1", outcome: "approved",
    });
    expect(state).toMatchObject({ round: 5, phase: "acting" });
    expect(evaluate(state)).toMatchObject({ round: 5, phase: "needs_human", stop_reason: "round_limit" });
  });

  it.each(["acting", "waiting_approval", "verifying"] as const)("%s可取消，已终止不能恢复", phase => {
    let state = createState();
    if (phase === "waiting_approval") state = waitForApproval(state);
    if (phase === "verifying") state = transitionGovernanceLoop(state, { type: "result_unknown", round: 1, revision: 0, action_ref: "execution-1" });
    state = transitionGovernanceLoop(state, { type: "cancel", round: 1, revision: state.revision });
    expect(state).toMatchObject({ phase: "needs_human", stop_reason: "cancelled" });
    expect(() => waitForApproval(state)).toThrow();
  });
});

describe("检查点与模型输出边界", () => {
  it("重复评估与同轮重复事件不能额外推进", () => {
    const initial = createState();
    const state = evaluate(initial);
    expect(() => transitionGovernanceLoop(state, {
      type: "evaluate", round: 1, revision: 0, observation_refs: ["obs"],
      assessment: { decision: "continue", progress: true, evidence_refs: ["obs"] },
    })).toThrow();
    const waiting = waitForApproval(initial);
    expect(() => transitionGovernanceLoop(waiting, {
      type: "approval_resolved", round: 1, revision: 0, action_ref: "request-1", outcome: "approved",
    })).toThrow();
  });

  it.each([
    { observation_refs: [], evidence_refs: [] },
    { observation_refs: ["obs"], evidence_refs: [] },
    { observation_refs: ["obs"], evidence_refs: ["invented"] },
    { observation_refs: ["obs", "obs"], evidence_refs: ["obs"] },
  ])("评估拒绝缺失、伪造或重复观察引用 %j", refs => {
    expect(() => transitionGovernanceLoop(createState(), {
      type: "evaluate", round: 1, revision: 0, observation_refs: refs.observation_refs,
      assessment: { decision: "goal_reached", progress: true, evidence_refs: refs.evidence_refs },
    })).toThrow();
  });

  it("上一轮观察不能冒充当前轮的新观察", () => {
    const state = evaluate(createState());
    expect(() => transitionGovernanceLoop(state, {
      type: "evaluate", round: 2, revision: state.revision, observation_refs: ["observation-1"],
      assessment: { decision: "goal_reached", progress: true, evidence_refs: ["observation-1"] },
    })).toThrow();
  });

  it("隔轮恢复也不能重用更早轮次的观察", () => {
    const state = GovernanceLoopStateSchema.parse(JSON.parse(JSON.stringify(evaluate(evaluate(createState())))));
    expect(() => transitionGovernanceLoop(state, {
      type: "evaluate", round: 3, revision: state.revision, observation_refs: ["observation-1"],
      assessment: { decision: "goal_reached", progress: true, evidence_refs: ["observation-1"] },
    })).toThrow();
  });

  it("模型不能通过评估字段修改轮数或加入批准", () => {
    expect(() => transitionGovernanceLoop(createState(), {
      type: "evaluate", round: 1, revision: 0, observation_refs: ["obs"],
      assessment: { decision: "continue", progress: true, evidence_refs: ["obs"], round: 0, approved: true },
    })).toThrow();
  });

  it("序列化往返保存根任务、轮数、版本和无进展次数", () => {
    const original = evaluate(evaluate(createState()), "continue", false);
    const restored = GovernanceLoopStateSchema.parse(JSON.parse(JSON.stringify(original)));
    expect(restored).toEqual(original);
    expect(evaluate(restored, "goal_reached")).toMatchObject({ task_id: original.task_id, trace_id: original.trace_id, round: 3 });
  });

  it("转换不修改输入检查点或评估引用数组", () => {
    const state = createState();
    const original = structuredClone(state);
    const observationRefs = ["obs"];
    const next = transitionGovernanceLoop(state, {
      type: "evaluate", round: 1, revision: 0, observation_refs: observationRefs,
      assessment: { decision: "continue", progress: true, evidence_refs: observationRefs },
    });
    observationRefs.push("later");
    expect(state).toEqual(original);
    expect(next.last_observation_refs).toEqual(["obs"]);
    expect(next.revision).toBe(1);
  });

  it.each([
    { round: 0 }, { round: 6 }, { revision: -1 }, { contract_version: 2 },
    { phase: "completed", stop_reason: null }, { phase: "acting", stop_reason: "round_limit" },
    { phase: "waiting_approval", pending_ref: null }, { phase: "acting", pending_ref: "request-1" },
    { consecutive_no_progress: 2 }, { phase: "needs_human", stop_reason: "goal_reached" },
    { round: 2, revision: 1 }, { last_observation_refs: ["missing-from-history"] },
  ])("无效或自相矛盾的检查点拒绝恢复 %j", change => {
    expect(GovernanceLoopStateSchema.safeParse({ ...createState(), ...change }).success).toBe(false);
  });
});
