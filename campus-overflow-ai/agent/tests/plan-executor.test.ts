// G-03 受控计划执行测试：计划契约、顺序执行、结果引用、越权拒绝、预算累计
// 覆盖《Agent层首批实施计划》G-03 检查点：未知工具、参数非法、越权、预算累计
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import {
  executePlan,
  PlanBudgetError,
  PlanExecutionError,
  PlanValidationError,
  validatePlan,
} from "../src/loop/plan-executor";
import { createToolRegistry, type AgentTool } from "../src/tools/registry";
import { asAgentRunId, asTraceId } from "../src/types";
import type { PlanList } from "../src/types/plan";

/** 测试工具：回显输入并构造可引用结果 */
const makeEchoTool = (): AgentTool => ({
  name: "echo",
  description: "回显输入",
  riskLevel: "low",
  inputSchema: z.object({
    keyword: z.string().min(1).max(100),
    limit: z.number().int().min(1).max(10),
  }),
  execute: vi.fn(async (input) => {
    const { keyword, limit } = input as { keyword: string; limit: number };
    return { items: Array.from({ length: limit }, (_, i) => ({ id: i + 1, title: `${keyword}-${i + 1}` })) };
  }),
});

const toolContext = { agentRunId: asAgentRunId("plan-x"), traceId: asTraceId("trace-plan-x") };

describe("受控计划执行（PlanList）", () => {
  const planWith = (steps: PlanList["steps"]): PlanList => ({ steps });

  it("顺序执行模型计划，$input.* 引用解析为任务输入", async () => {
    const registry = createToolRegistry();
    registry.registerTool(makeEchoTool());
    const plan = planWith([
      { stepId: "s1", objective: "检索关键词", toolName: "echo", args: { keyword: "$input.questionTitle", limit: "$input.limit" } },
    ]);
    const result = await executePlan(plan, {
      registry,
      toolContext,
      input: { questionTitle: "银行家算法", limit: 5 },
    });
    expect(result.failures.size).toBe(0);
    expect(result.toolCallCount).toBe(1);
    expect(result.stepResults.get("s1")).toEqual({
      items: Array.from({ length: 5 }, (_, i) => ({ id: i + 1, title: `银行家算法-${i + 1}` })),
    });
    const echo = registry.getTool("echo")!;
    expect(echo.execute).toHaveBeenCalledWith(
      { keyword: "银行家算法", limit: 5 },
      expect.objectContaining({ agentRunId: "plan-x" }),
    );
  });

  it("$stepId.* 引用前序步骤结果，并支持数组索引", async () => {
    const registry = createToolRegistry();
    registry.registerTool(makeEchoTool());
    const plan = planWith([
      { stepId: "s1", objective: "第一步", toolName: "echo", args: { keyword: "TCP", limit: 2 } },
      { stepId: "s2", objective: "引用第一步", toolName: "echo", args: { keyword: "$s1.items[0].title", limit: 1 } },
    ]);
    const result = await executePlan(plan, { registry, toolContext, input: {} });
    expect(result.failures.size).toBe(0);
    expect(result.stepResults.get("s2")).toEqual({ items: [{ id: 1, title: "TCP-1-1" }] });
    expect(result.toolCallCount).toBe(2);
  });

  it("未知工具：计划引用未注册工具被拒绝（PlanValidationError）", async () => {
    const registry = createToolRegistry();
    registry.registerTool(makeEchoTool());
    const plan = planWith([{ stepId: "s1", objective: "调用不存在工具", toolName: "deleteAll", args: {} }]);
    await expect(executePlan(plan, { registry, toolContext, input: {} })).rejects.toBeInstanceOf(
      PlanValidationError,
    );
  });

  it("参数非法：超出工具 schema 的参数被拒绝（PlanExecutionError）", async () => {
    const registry = createToolRegistry();
    registry.registerTool(makeEchoTool());
    const plan = planWith([{ stepId: "s1", objective: "超限参数", toolName: "echo", args: { keyword: "TCP", limit: 100 } }]);
    await expect(executePlan(plan, { registry, toolContext, input: {} })).rejects.toBeInstanceOf(
      PlanExecutionError,
    );
  });

  it("越权：模型计划指定操作者身份（user_id/role）被拒绝，不得作为授权依据", async () => {
    const registry = createToolRegistry();
    registry.registerTool(makeEchoTool());
    const plan = planWith([
      { stepId: "s1", objective: "指定用户", toolName: "echo", args: { keyword: "TCP", limit: 1, user_id: 9 } },
    ]);
    await expect(executePlan(plan, { registry, toolContext, input: {} })).rejects.toBeInstanceOf(
      PlanValidationError,
    );
    const planB = planWith([
      { stepId: "s1", objective: "指定角色", toolName: "echo", args: { keyword: "TCP", limit: 1, role: "admin" } },
    ]);
    await expect(executePlan(planB, { registry, toolContext, input: {} })).rejects.toBeInstanceOf(
      PlanValidationError,
    );
  });

  it("越权：任务输入不含身份字段，$input.user_id 引用被拒绝", async () => {
    const registry = createToolRegistry();
    registry.registerTool(makeEchoTool());
    const plan = planWith([
      { stepId: "s1", objective: "引用身份字段", toolName: "echo", args: { keyword: "$input.user_id", limit: 1 } },
    ]);
    await expect(
      executePlan(plan, { registry, toolContext, input: { questionTitle: "TCP" } }),
    ).rejects.toBeInstanceOf(PlanExecutionError);
  });

  it("字符串模板/表达式不是合法引用，一律拒绝", async () => {
    const registry = createToolRegistry();
    registry.registerTool(makeEchoTool());
    const plan = planWith([
      { stepId: "s1", objective: "模板拼接", toolName: "echo", args: { keyword: "$s1.items[0].title + 后缀", limit: 1 } },
    ]);
    await expect(executePlan(plan, { registry, toolContext, input: {} })).rejects.toBeInstanceOf(
      PlanValidationError,
    );
  });

  it("引用未执行步骤的结果被拒绝", async () => {
    const registry = createToolRegistry();
    registry.registerTool(makeEchoTool());
    const plan = planWith([
      { stepId: "s1", objective: "前向引用", toolName: "echo", args: { keyword: "$s2.items[0].title", limit: 1 } },
    ]);
    await expect(executePlan(plan, { registry, toolContext, input: {} })).rejects.toBeInstanceOf(
      PlanExecutionError,
    );
  });

  it("预算累计：运行级已用次数跨计划累计，超 12 次拒绝继续执行", async () => {
    const registry = createToolRegistry();
    registry.registerTool(makeEchoTool());
    const planSteps = (count: number): PlanList["steps"] =>
      Array.from({ length: count }, (_, i) => ({
        stepId: `s${i + 1}`,
        objective: `步骤 ${i + 1}`,
        toolName: "echo",
        args: { keyword: "TCP", limit: 1 },
      }));
    // 第一次执行 8 步（spent 0→8）
    const first = await executePlan(planWith(planSteps(8)), { registry, toolContext, input: {} });
    expect(first.toolCallCount).toBe(8);
    // 第二次执行 5 步：累计 8+5=13 超 12，第 5 步执行前拒绝
    await expect(
      executePlan(planWith(planSteps(5)), { registry, toolContext, input: {}, spentToolCalls: first.toolCallCount }),
    ).rejects.toBeInstanceOf(PlanBudgetError);
  });

  it("必需工具约束：计划缺少任务必需工具步骤被拒绝", async () => {
    const registry = createToolRegistry();
    registry.registerTool(makeEchoTool());
    const plan = planWith([{ stepId: "s1", objective: "无词表步骤", toolName: "echo", args: { keyword: "TCP", limit: 1 } }]);
    expect(() => validatePlan(plan, { registry, requiredTools: ["fetchTags"] })).toThrow(PlanValidationError);
    expect(() => validatePlan(plan, { registry, requiredTools: ["echo"] })).not.toThrow();
  });

  it("非低风险工具与重复步骤 ID 被拒绝", async () => {
    const registry = createToolRegistry();
    registry.registerTool(makeEchoTool());
    registry.registerTool({
      name: "moderate",
      description: "审批级工具",
      riskLevel: "high",
      inputSchema: z.object({ keyword: z.string() }),
      execute: vi.fn(async () => ({ ok: true })),
    });
    const highRiskPlan = planWith([
      { stepId: "s1", objective: "高风险工具", toolName: "moderate", args: { keyword: "x" } },
    ]);
    await expect(executePlan(highRiskPlan, { registry, toolContext, input: {} })).rejects.toBeInstanceOf(
      PlanValidationError,
    );
    const dupPlan = planWith([
      { stepId: "s1", objective: "重复 ID", toolName: "echo", args: { keyword: "TCP", limit: 1 } },
      { stepId: "s1", objective: "重复 ID 2", toolName: "echo", args: { keyword: "TCP", limit: 1 } },
    ]);
    await expect(executePlan(dupPlan, { registry, toolContext, input: {} })).rejects.toBeInstanceOf(
      PlanValidationError,
    );
  });

  it("步骤运行期失败按步骤收集（failures），不中断后续步骤", async () => {
    const registry = createToolRegistry();
    registry.registerTool({
      name: "flaky",
      description: "可能失败的工具",
      riskLevel: "low",
      inputSchema: z.object({ value: z.string() }),
      execute: vi.fn(async () => {
        throw new Error("backend down");
      }),
    });
    registry.registerTool(makeEchoTool());
    const flakyPlan = planWith([
      { stepId: "s1", objective: "会失败", toolName: "flaky", args: { value: "x" } },
      { stepId: "s2", objective: "继续执行", toolName: "echo", args: { keyword: "TCP", limit: 1 } },
    ]);
    const result = await executePlan(flakyPlan, { registry, toolContext, input: {} });
    expect(result.failures.get("s1")).toBeInstanceOf(Error);
    expect(result.stepResults.get("s2")).toBeTruthy();
    expect(result.toolCallCount).toBe(2);
  });
});
