// 自检：结构化输出经 Zod schema 校验，失败重试一次；二次失败不返回任何未校验内容
// （agent端需求文档 §3.1 验收：自检失败时不得把未通过校验的输出返回给用户）
import { generateObject, NoObjectGeneratedError, type LanguageModel } from "ai";
import { z } from "zod";

import { assertModelCompleted, ModelCompletionError } from "./model-completion.js";
import { RunStoppedError, withUpstreamDeadline } from "./abort.js";
import type { RepairBudget } from "./repair-budget.js";

export class SelfCheckError extends Error {
  constructor(message: string) {
    super(`self-check failed: ${message}`);
    this.name = "SelfCheckError";
  }
}

export interface StructuredCallOptions<T> {
  feedback?: readonly string[];
  repairBudget?: RepairBudget;
  signal?: AbortSignal;
  model: LanguageModel;
  schema: z.ZodType<T>;
  system: string;
  prompt: string;
  /** 自检失败重试次数上限，默认 1 */
  maxRetries?: number;
}

export const generateStructured = async <T>(options: StructuredCallOptions<T>): Promise<T> => {
  const maxRetries = options.maxRetries ?? 1;
  const call = async (attempt: number): Promise<T> => {
    const { object, finishReason } = await withUpstreamDeadline(options.signal, (abortSignal) => generateObject({
      model: options.model,
      schema: options.schema,
      system: options.system,
      prompt: options.prompt
        + (options.feedback?.length ? `\n上一轮自检问题代码：${options.feedback.join(",")}；请修正这些问题。` : "")
        + (attempt > 0 ? "\n上次结果结构不合法，请只输出符合所需结构的 JSON。" : ""),
      abortSignal,
      maxRetries: 0,
    }));
    assertModelCompleted(finishReason);
    // generateObject 已按 schema 解析，这里再显式 parse 一次作为自检兜底
    return options.schema.parse(object);
  };

  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      return await call(attempt);
    } catch (error) {
      if (error instanceof ModelCompletionError) throw error;
      if (error instanceof RunStoppedError) throw error;
      // SDK 可能先因无文本或 JSON 解析失败抛错，仍需检查其中的结束原因。
      if (NoObjectGeneratedError.isInstance(error)) assertModelCompleted(error.finishReason);
      if (!NoObjectGeneratedError.isInstance(error) && !(error instanceof z.ZodError)) throw error;
      lastError = error;
      if (attempt < maxRetries) options.repairBudget?.consume();
    }
  }
  throw new SelfCheckError(lastError instanceof Error ? lastError.message : String(lastError));
};
