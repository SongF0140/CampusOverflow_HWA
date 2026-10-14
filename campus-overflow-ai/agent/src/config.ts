// 环境配置：模型接入与内部接口地址统一读取，避免散落 process.env
// 首行 import 必须是 env-guard：先清掉空串环境变量，再加载 @ai-sdk/openai（后者模块顶层就会读 OPENAI_BASE_URL）
import "./env-guard.js";

import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";

export interface ModelConfig {
  apiKey: string;
  baseURL?: string;
  modelId: string;
}

export class ModelNotConfiguredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ModelNotConfiguredError";
  }
}

export const resolveModelConfig = (): ModelConfig => ({
  apiKey: process.env.OPENAI_API_KEY ?? "",
  // 空串归一为 undefined：?? 运算符拦不住空字符串，而 SDK 对空 baseURL 是断言失败而非降级
  baseURL: process.env.OPENAI_BASE_URL || undefined,
  modelId: process.env.AGENT_MODEL_ID ?? "gpt-4o-mini",
});

export const createLanguageModel = (config: ModelConfig = resolveModelConfig()): LanguageModel => {
  if (!config.apiKey) {
    throw new ModelNotConfiguredError("模型未配置：缺少 OPENAI_API_KEY");
  }
  const provider = createOpenAI({ apiKey: config.apiKey, baseURL: config.baseURL });
  return provider(config.modelId);
};
