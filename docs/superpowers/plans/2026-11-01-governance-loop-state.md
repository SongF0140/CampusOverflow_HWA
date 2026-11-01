# WF-01 治理五轮状态契约实施计划

> **For agentic workers:** 使用 executing-plans 在当前会话逐项执行；不启动子 Agent。每个可独立审查块验证、提交后按 AGENTS.md 等待人工审查。

**Goal:** 为已批准的自治理闭环提供可序列化、严格校验且最多五轮的状态转换契约。

**Architecture:** 纯状态转换独立于 Hono、模型和 Workflow。可信适配器提交轮次/版本事件与本轮观察引用；状态模块决定继续、等待或终止，后续 Workflow 将其作为持久检查点。

**Tech Stack:** 现有 TypeScript、Zod 4、Vitest；本块无新依赖。

## Global Constraints

- 完整治理 loop 最多 5 轮，单轮多个动作不累计轮数。
- 后端为授权与执行回执真值源；本模块不是批准凭证。
- 不直接连接数据库、不修改生产入口、不执行真实治理、不推送部署。
- 所有事件带当前 round/revision；评估引用必须来自当前轮观察。
- 文档先行、TDD、相关测试 + Agent lint/type，逐块本地提交。

## 文件与接口

- Create: `campus-overflow-ai/agent/src/loop/governance-loop-state.ts`：`createGovernanceLoopState({ task_id, trace_id })`、`transitionGovernanceLoop(state, event)`，导出状态 schema/type 和 `MAX_GOVERNANCE_ROUNDS=5`。
- Create: `campus-overflow-ai/agent/tests/governance-loop-state.test.ts`：轮数、引用、等待、未知、恢复与重放反例。
- Modify: `campus-overflow-ai/agent/src/loop/README.md`：协议用途和未接线边界。
- Docs: spec/plan/tasks/analyze、设计文档、审批决策与 `docs/审查记录/WF-01治理五轮状态契约/审查记录.md`。

### Task 1：先建立行为反例

- [x] 创建缺失模块的测试，核心断言如下：

```ts
let state = createGovernanceLoopState({ task_id: crypto.randomUUID(), trace_id: "wf-test" });
for (let round = 1; round <= 5; round += 1) {
  state = transitionGovernanceLoop(state, {
    type: "evaluate", round, revision: state.revision,
    observation_refs: [`observation-${round}`],
    assessment: { decision: "continue", progress: true, evidence_refs: [`observation-${round}`] },
  });
}
expect(state).toMatchObject({ round: 5, phase: "needs_human", stop_reason: "round_limit" });
```

- [x] 补充第五轮 goal_reached、多动作不计轮、审批批准/拒绝/到期/取消、未知先核对、错误引用、状态篡改、重复事件和 JSON 往返用例。
- [x] 执行 `npm test -- tests/governance-loop-state.test.ts`，确认模块缺失导致红灯，保留结果。

### Task 2：最小实现与验证

- [x] 按设计定义 Zod strict 状态/事件/评估 schema；状态转换按事件先检查 round/revision，再检查 phase 与关联引用。
- [x] evaluate 验证观察引用，按 goal_reached/handoff/连续两轮无进展/第五轮上限/继续的顺序处理；仅继续可 round+1；不在动作、等待或结果核对事件中加轮。
- [x] 状态转换返回新对象并通过 schema 验证，终态拒绝任何推进。
- [x] 执行 `npm test -- tests/governance-loop-state.test.ts tests/governance-executor.test.ts tests/approved-actions.test.ts tests/tool-security-hooks.test.ts`，随后 `npx tsc --noEmit` 与 `npm run lint`。

### Task 3：记录与审查节点

- [x] 写明测试数量、红绿证据、C-05/06/08 检查与后续 Workflow 接线限制；回填 WF-01 状态，不勾 WF-02～04/CHAT-01。
- [x] 仅暂存本块文件和任务清单新增段，不提交用户原有 tasks.md 更改及未跟踪验收记录。
- [x] 本地提交 `feat: 定义自治理五轮闭环状态契约`，提供审查记录后等待本块审查。

自审：需求 WF-R01～06 均有对应状态或后续任务；WF-01 不宣称执行器、LLM 或持久运行时已接入。未把 SDK step count=5 写成治理轮数，也未放宽原后端授权。
