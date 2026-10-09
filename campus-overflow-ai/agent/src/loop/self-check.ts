// 自检：结构化输出经 Zod schema 校验，失败重试一次；二次失败不返回任何未校验内容
// （agent端需求文档 §3.1 验收：自检失败时不得把未通过校验的输出返回给用户）
import { generateObject, type LanguageModel } from "ai";
import { z } from "zod";

export class SelfCheckError extends Error {
  constructor(message: string) {
    super(`self-check failed: ${message}`);
    this.name = "SelfCheckError";
  }
}

export interface StructuredCallOptions<T> {
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
    const { object } = await generateObject({
      model: options.model,
      schema: options.schema,
      system: options.system,
      prompt: options.prompt,
    });
    // generateObject 已按 schema 解析，这里再显式 parse 一次作为自检兜底
    return options.schema.parse(object);
  };

  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      return await call();
    } catch (error) {
      lastError = error;
    }
  }
  throw new SelfCheckError(lastError instanceof Error ? lastError.message : String(lastError));
};
