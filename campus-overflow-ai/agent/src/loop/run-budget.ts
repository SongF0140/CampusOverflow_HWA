import { MAX_TOOL_CALLS } from "../types/plan.js";

export class PlanBudgetError extends Error {
  constructor(message: string) {
    super(`plan budget exceeded: ${message}`);
    this.name = "PlanBudgetError";
  }
}

export interface ToolCallBudget {
  readonly used: number;
  consume: () => void;
}

/** 预算归属本次运行，异常退出不回滚，调用方不能写入累计值。 */
export const createToolCallBudget = (): ToolCallBudget => {
  let used = 0;
  return Object.freeze({
    get used() { return used; },
    consume: () => {
      if (used >= MAX_TOOL_CALLS) {
        throw new PlanBudgetError(`达到累计工具调用上限（${MAX_TOOL_CALLS} 次）`);
      }
      used += 1;
    },
  });
};
