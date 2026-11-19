// MCP 每客户端限流（P4）：进程内令牌桶，默认 60 次/分钟，容量即每分钟额度。
// 限流位于鉴权之后、工具执行之前，超限直接 429 并写审计；桶按客户端名共享，
// 同一客户端的主/备 token 共用额度，客户端数量由配置决定，不会无界增长。
export const DEFAULT_MCP_RATE_LIMIT_PER_MINUTE = 60;

const WINDOW_MS = 60_000;

export interface McpRateLimiter {
  readonly limitPerMinute: number;
  /** 消耗一个令牌；额度不足返回 false（不阻塞、不排队） */
  tryAcquire: (clientName: string) => boolean;
}

interface TokenBucket {
  tokens: number;
  updatedAt: number;
}

export interface McpRateLimiterOptions {
  /** 时钟注入（测试用），默认 Date.now */
  now?: () => number;
}

/** 解析 MCP_RATE_LIMIT_PER_MINUTE；非法值启动即失败，避免静默放宽额度 */
export const resolveRateLimitPerMinute = (raw: string | undefined): number => {
  if (raw === undefined || raw === "") return DEFAULT_MCP_RATE_LIMIT_PER_MINUTE;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error("MCP_RATE_LIMIT_PER_MINUTE 必须为正整数");
  }
  return parsed;
};

export const createTokenBucketRateLimiter = (
  limitPerMinute: number,
  options: McpRateLimiterOptions = {},
): McpRateLimiter => {
  if (!Number.isInteger(limitPerMinute) || limitPerMinute <= 0) {
    throw new Error("MCP 限流配置必须为正整数");
  }
  const now = options.now ?? Date.now;
  const refillPerMs = limitPerMinute / WINDOW_MS;
  const buckets = new Map<string, TokenBucket>();

  return {
    limitPerMinute,
    tryAcquire: (clientName) => {
      const current = now();
      const bucket = buckets.get(clientName) ?? { tokens: limitPerMinute, updatedAt: current };
      const elapsed = Math.max(0, current - bucket.updatedAt);
      const available = Math.min(limitPerMinute, bucket.tokens + elapsed * refillPerMs);
      if (available < 1) {
        buckets.set(clientName, { tokens: available, updatedAt: current });
        return false;
      }
      buckets.set(clientName, { tokens: available - 1, updatedAt: current });
      return true;
    },
  };
};
