export interface WebConfig {
  enabled: boolean;
  browserEnabled: boolean;
  apiKey: string;
}

/** 配置只保存在服务端工具闭包，不进入模型描述或持久Run输入。 */
export const readWebConfig = (env: NodeJS.ProcessEnv = process.env): WebConfig => ({
  enabled: env.WEB_SEARCH_ENABLED === "true",
  browserEnabled: env.WEB_BROWSER_ENABLED === "true",
  apiKey: env.TAVILY_API_KEY?.trim() ?? "",
});
