import type { MockLanguageModelV4 } from "ai/test";

/** 旧入口用例显式提供审查响应；专项 reviewed-run 测试自行控制认可/否定。 */
export const approvedReview = (options: Parameters<MockLanguageModelV4["doGenerate"]>[0]) => {
  if (!options.prompt.some((message) => message.role === "system" && message.content.includes("受控结果审查器"))) return undefined;
  return { content: [{ type: "text" as const, text: JSON.stringify({ passed: true, issues: [] }) }],
    finishReason: { unified: "stop" as const, raw: undefined }, warnings: [],
    usage: { inputTokens: { total: 0, noCache: 0, cacheRead: 0, cacheWrite: 0 },
      outputTokens: { total: 0, text: 0, reasoning: 0 } } };
};
