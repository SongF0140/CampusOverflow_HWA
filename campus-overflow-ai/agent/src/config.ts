// 环境配置：模型接入与内部接口地址统一读取，避免散落 process.env
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
  baseURL: process.env.OPENAI_BASE_URL,
  modelId: process.env.AGENT_MODEL_ID ?? "gpt-4o-mini",
});

export const createLanguageModel = (config: ModelConfig = resolveModelConfig()): LanguageModel => {
  if (!config.apiKey) {
    throw new ModelNotConfiguredError("模型未配置：缺少 OPENAI_API_KEY");
  }
  const provider = createOpenAI({ apiKey: config.apiKey, baseURL: config.baseURL });
  return provider(config.modelId);
};
