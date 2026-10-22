// 自检：结构化输出经 Zod schema 校验，失败重试一次；二次失败不返回任何未校验内容
// （agent端需求文档 §3.1 验收：自检失败时不得把未通过校验的输出返回给用户）
import { generateObject, NoObjectGeneratedError, type LanguageModel } from "ai";
import { z } from "zod";

import { assertModelCompleted, ModelCompletionError } from "./model-completion.js";
import { RunStoppedError, withUpstreamDeadline } from "./abort.js";

export class SelfCheckError extends Error {
  constructor(message: string) {
    super(`self-check failed: ${message}`);
    this.name = "SelfCheckError";
  }
}

export interface StructuredCallOptions<T> {
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
  const call = async (): Promise<T> => {
    const { object, finishReason } = await withUpstreamDeadline(options.signal, (abortSignal) => generateObject({
      model: options.model,
      schema: options.schema,
      system: options.system,
      prompt: options.prompt,
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
      return await call();
    } catch (error) {
      if (error instanceof ModelCompletionError) throw error;
      if (error instanceof RunStoppedError) throw error;
      // SDK 可能先因无文本或 JSON 解析失败抛错，仍需检查其中的结束原因。
      if (NoObjectGeneratedError.isInstance(error)) assertModelCompleted(error.finishReason);
      lastError = error;
    }
  }
  throw new SelfCheckError(lastError instanceof Error ? lastError.message : String(lastError));
};
