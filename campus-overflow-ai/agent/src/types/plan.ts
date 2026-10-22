// 受控规划契约（G-03 / AG-R02）：模型生成 PlanList，程序逐步校验并顺序执行。
// 本文件只定义计划契约与预算常量；校验/执行在 loop/plan-executor.ts，生成在 loop/plan-generator.ts。
import { z } from "zod";

/** 初始计划步数上限（AG-R02：限制总执行量，首轮计划最多 8 步） */
export const MAX_PLAN_STEPS = 8;

/** 单次运行累计工具调用预算（AG-R02：12 次；跨返工累计，返工不得重置预算） */
export const MAX_TOOL_CALLS = 12;

/** 计划步骤 ID：小写 s + 正整数（s1、s2…），计划内唯一 */
export const PLAN_STEP_ID_PATTERN = /^s\d+$/;

/** 任务输入引用保留名：$input.xxx 指向本次任务入参（同 $stepId.路径 一样只做静态路径解析） */
export const INPUT_REF_ID = "input";

/** 结果/输入引用语法：$s1.items[0].title 或 $input.questionTitle；
 * 仅允许已执行步骤/输入 + 标识符字段 + 纯数字数组索引，函数调用与表达式一律不匹配 */
export const STEP_REF_PATTERN = /^\$(?:s\d+|input)(?:(?:\.[A-Za-z_][A-Za-z0-9_]*)|(?:\[\d+\]))*$/;

export const PlanStepSchema = z.object({
  stepId: z.string().regex(PLAN_STEP_ID_PATTERN, "步骤 ID 必须形如 s1、s2"),
  objective: z.string().min(1).max(200),
  toolName: z.string().min(1).max(50),
  args: z.record(z.string(), z.unknown()).default({}),
});
export type PlanStep = z.infer<typeof PlanStepSchema>;

export const PlanListSchema = z.object({
  steps: z.array(PlanStepSchema).max(MAX_PLAN_STEPS),
});
export type PlanList = z.infer<typeof PlanListSchema>;
