// 受控计划生成（G-03 / AG-R02）：模型按任务目标与可用工具生成 PlanList，
// 生成后立即程序校验（步骤数、白名单、必需工具、引用语法、拒绝身份字段），校验不过即失败。
import type { LanguageModel } from "ai";

import { PlanListSchema, type PlanList } from "../types/plan.js";
import { validatePlan, type PlanValidationOptions } from "./plan-executor.js";
import { generateStructured } from "./self-check.js";

export interface GeneratePlanOptions extends PlanValidationOptions {
  model: LanguageModel;
  /** 计划层系统提示词（buildPlanningSystem 产出） */
  system: string;
  /** 计划阶段提示词（任务输入 + 可用工具清单 + 要求） */
  prompt: string;
}

export const generatePlan = async (options: GeneratePlanOptions): Promise<PlanList> => {
  const plan = await generateStructured<PlanList>({
    model: options.model,
    schema: PlanListSchema,
    system: options.system,
    prompt: options.prompt,
  });
  validatePlan(plan, { registry: options.registry, requiredTools: options.requiredTools });
  return plan;
};
