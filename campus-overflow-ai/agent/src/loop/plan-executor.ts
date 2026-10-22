// 受控计划执行（G-03 / AG-R02）：程序逐步校验并顺序执行模型生成的 PlanList。
// 未知工具、非低风险工具、越权参数、非法引用、参数非法 → 拒绝该调用（明确失败，不自动重试）；
// 普通工具错误按步骤收集，401/403 立即终止；预算跨计划/返工累计且不重置。
// 授权依据永远是运行上下文的后端可信 principal，而非计划中模型声明的任何身份字段。
import { z } from "zod";

import { InternalApiError } from "../internal-client.js";
import type { ToolExecutionContext, ToolRegistry } from "../tools/registry.js";
import type { PlanList, PlanStep } from "../types/plan.js";
import { INPUT_REF_ID, MAX_PLAN_STEPS } from "../types/plan.js";
import type { ToolCallBudget } from "./run-budget.js";

export { PlanBudgetError } from "./run-budget.js";

export class PlanValidationError extends Error {
  constructor(message: string) {
    super(`plan invalid: ${message}`);
    this.name = "PlanValidationError";
  }
}

export class PlanExecutionError extends Error {
  constructor(message: string) {
    super(`plan execution failed: ${message}`);
    this.name = "PlanExecutionError";
  }
}

/** 内部工具禁止接受模型生成的操作者身份（AG-R02：不能以模型指定用户/角色为授权依据） */
const FORBIDDEN_ARG_KEYS = ["user_id", "role", "principal", "operator", "operator_id", "user", "actor"];

/** 参数键命中身份字段名即拒绝 */
export const assertNoForbiddenArgKey = (key: string): void => {
  if (FORBIDDEN_ARG_KEYS.includes(key)) {
    throw new PlanValidationError(`参数不允许指定模型操作者身份：${key}`);
  }
};

/** 解析引用语法：$s1.items[0].title / $input.questionTitle → { target, path }；非纯引用返回 null */
export const parseStepRef = (
  value: string,
): { target: string; path: Array<string | number> } | null => {
  const match = /^\$(s\d+|input)((?:\.[A-Za-z_][A-Za-z0-9_]*|\[\d+\])*)$/.exec(value);
  if (!match) return null;
  const path: Array<string | number> = [];
  for (const segment of match[2].matchAll(/\.([A-Za-z_][A-Za-z0-9_]*)|\[(\d+)\]/g)) {
    path.push(segment[1] ?? Number(segment[2]));
  }
  return { target: match[1], path };
};

const resolveRefValue = (
  ref: string,
  parsed: { target: string; path: Array<string | number> },
  stepResults: ReadonlyMap<string, unknown>,
  input: unknown,
): unknown => {
  let value: unknown;
  if (parsed.target === INPUT_REF_ID) {
    value = input;
  } else {
    if (!stepResults.has(parsed.target)) {
      throw new PlanExecutionError(`引用了未执行的步骤：${parsed.target}`);
    }
    value = stepResults.get(parsed.target);
  }
  for (const segment of parsed.path) {
    if (typeof segment === "number") {
      if (!Array.isArray(value) || segment >= value.length || !Object.hasOwn(value, segment)) {
        throw new PlanExecutionError(`引用路径无效或越界：${ref}`);
      }
      value = value[segment];
    } else {
      if (typeof value !== "object" || value === null || Array.isArray(value)) {
        throw new PlanExecutionError(`引用路径类型错误：${ref}`);
      }
      if (!Object.hasOwn(value, segment)) {
        throw new PlanExecutionError(`引用字段不存在：${ref}`);
      }
      value = (value as Record<string, unknown>)[segment];
    }
  }
  return value;
};

/** 解析步骤参数：值若以 $ 开头必须是完整纯引用；其余按字面量传给工具 schema 校验 */
const resolveArgs = (
  step: PlanStep,
  stepResults: ReadonlyMap<string, unknown>,
  input: unknown,
): Record<string, unknown> => {
  const resolved: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(step.args)) {
    assertNoForbiddenArgKey(key);
    if (typeof raw === "string" && raw.startsWith("$")) {
      const parsed = parseStepRef(raw);
      if (!parsed) {
        throw new PlanValidationError(`参数 ${key} 不是合法的 $stepId.路径 引用：${raw}`);
      }
      resolved[key] = resolveRefValue(raw, parsed, stepResults, input);
    } else {
      resolved[key] = raw;
    }
  }
  return resolved;
};

export interface PlanValidationOptions {
  /** 请求级工具注册表（G-02：每请求独立注册表，即当前用户能力集） */
  registry: ToolRegistry;
  /** 任务必需的工具步骤：计划中必须至少出现一次，缺失即拒绝 */
  requiredTools?: readonly string[];
}

const requireExecutableTool = (registry: ToolRegistry, name: string) => {
  const tool = registry.getTool(name);
  if (!tool) throw new PlanValidationError(`计划使用了未知工具：${name}`);
  if (!tool.execute || tool.riskLevel !== "low") {
    throw new PlanValidationError(`工具不允许计划执行（需人工审批或未提供实现）：${name}`);
  }
  return tool;
};

/** 计划静态校验：步骤数、ID 唯一、工具在白名单且低风险可执行、必需工具、引用语法、拒绝身份字段 */
export const validatePlan = (plan: PlanList, options: PlanValidationOptions): void => {
  if (plan.steps.length === 0) {
    throw new PlanValidationError("计划必须包含至少一个工具步骤");
  }
  if (plan.steps.length > MAX_PLAN_STEPS) {
    throw new PlanValidationError(`计划步骤超过上限 ${MAX_PLAN_STEPS}`);
  }
  const seenStepIds = new Set<string>();
  const usedTools = new Set<string>();
  for (const step of plan.steps) {
    if (seenStepIds.has(step.stepId)) {
      throw new PlanValidationError(`步骤 ID 重复：${step.stepId}`);
    }
    seenStepIds.add(step.stepId);
    requireExecutableTool(options.registry, step.toolName);
    usedTools.add(step.toolName);
    for (const [key, value] of Object.entries(step.args)) {
      assertNoForbiddenArgKey(key);
      if (typeof value === "string" && value.startsWith("$") && !parseStepRef(value)) {
        throw new PlanValidationError(`参数 ${key} 不是合法的 $stepId.路径 引用：${value}`);
      }
    }
  }
  for (const required of options.requiredTools ?? []) {
    if (!usedTools.has(required)) {
      throw new PlanValidationError(`计划缺少必需的工具步骤：${required}`);
    }
  }
};

export interface ExecutePlanOptions extends PlanValidationOptions {
  /** 工具执行上下文：principal 来自运行上下文（后端已验证），不来自模型 */
  toolContext: ToolExecutionContext & { readonly toolBudget: ToolCallBudget };
  /** 任务输入：供 $input.* 引用（通过则动态解析） */
  input: unknown;
}

export interface ExecutePlanResult {
  /** 步骤结果：stepId → 工具返回值（按实际执行顺序） */
  stepResults: Map<string, unknown>;
  /** 步骤运行期错误：stepId → 错误（工具执行失败，任务按语义降级或转失败） */
  failures: Map<string, unknown>;
  /** 同一运行至今累计发出的工具调用次数（包含失败调用） */
  toolCallCount: number;
}

export const executePlan = async (
  plan: PlanList,
  options: ExecutePlanOptions,
): Promise<ExecutePlanResult> => {
  validatePlan(plan, options);
  const stepResults = new Map<string, unknown>();
  const failures = new Map<string, unknown>();
  for (const step of plan.steps) {
    const tool = requireExecutableTool(options.registry, step.toolName);
    const args = resolveArgs(step, stepResults, options.input);
    let parsedArgs: unknown;
    try {
      parsedArgs = tool.inputSchema ? tool.inputSchema.parse(args) : args;
    } catch (error) {
      const detail =
        error instanceof z.ZodError
          ? error.issues[0]?.message ?? "参数不合法"
          : error instanceof Error
            ? error.message
            : String(error);
      throw new PlanExecutionError(`步骤 ${step.stepId}（${step.toolName}）参数校验失败：${detail}`);
    }
    options.toolContext.toolBudget.consume();
    try {
      stepResults.set(step.stepId, await tool.execute!(parsedArgs, options.toolContext));
    } catch (error) {
      if (error instanceof InternalApiError && (error.status === 401 || error.status === 403)) throw error;
      failures.set(step.stepId, error);
    }
  }
  return { stepResults, failures, toolCallCount: options.toolContext.toolBudget.used };
};
