// MCP 客户端凭证与 scope 策略（T-17 N-01，Q-11③；P4 增补轮换与过期）：
// 大系统持专属服务凭证（token → scopes 绑定）；调用允许当且仅当工具 scope
// 在客户端 scopes 内。比对 timing-safe，不依赖提示词（统一策略代码强制）。
// 每个客户端最多两个有效凭证，轮换期重叠；过期凭证在鉴权阶段直接跳过。
import { timingSafeEqual } from "node:crypto";

import {
  MCP_TOOL_SCOPES,
  type McpToolDefinition,
  type McpToolScope,
} from "./registry.js";

/** 单客户端同时持有的凭证上限（主/备轮换窗口） */
export const MAX_TOKENS_PER_CLIENT = 2;

export interface McpClientToken {
  /** 专属凭证（Bearer token 原文，仅驻留服务端配置） */
  token: string;
  /** 过期时间（毫秒时间戳）；缺省视为长期有效 */
  expiresAt?: number;
}

export interface McpClientConfig {
  /** 客户端名（审计用，如 "campus-portal"） */
  name: string;
  /** 权限范围：read / admin:query / admin:act */
  scopes: string[];
  /** 轮换期内的有效凭证（1～2 个） */
  tokens: McpClientToken[];
  /** 调后端管理员接口时使用的稳定外部密钥；轮换凭证不改变该密钥 */
  externalKey: string;
}

export interface McpClientPrincipal {
  name: string;
  scopes: readonly string[];
}

const BEARER_PREFIX = "bearer ";

const isTokenActive = (token: McpClientToken, now: number): boolean =>
  token.expiresAt === undefined || token.expiresAt > now;

/** 从 Authorization 头解析客户端身份；无效/缺失/已过期返回 null（401，不区分原因） */
export const authenticateClient = (
  authorization: string | undefined,
  clients: readonly McpClientConfig[],
  now: number = Date.now(),
): McpClientPrincipal | null => {
  if (!authorization) return null;
  const trimmed = authorization.trim();
  if (trimmed.length <= BEARER_PREFIX.length) return null;
  if (trimmed.slice(0, BEARER_PREFIX.length).toLowerCase() !== BEARER_PREFIX) return null;
  const token = trimmed.slice(BEARER_PREFIX.length).trim();
  if (!token) return null;
  const tokenBytes = Buffer.from(token);
  for (const client of clients) {
    for (const candidate of client.tokens) {
      if (!isTokenActive(candidate, now)) continue;
      const expected = Buffer.from(candidate.token);
      if (expected.length === tokenBytes.length && timingSafeEqual(expected, tokenBytes)) {
        return { name: client.name, scopes: [...client.scopes] };
      }
    }
  }
  return null;
};

export class McpScopeDeniedError extends Error {
  constructor(readonly requiredScope: string) {
    super(`客户端无该工具所需权限范围：${requiredScope}`);
    this.name = "McpScopeDeniedError";
  }
}

/** 调用前强制策略：scope 不足即拒绝（server 层转 isError 结果并留审计） */
export const assertCallAllowed = (
  principal: McpClientPrincipal,
  tool: Pick<McpToolDefinition, "name" | "scope">,
): void => {
  if (!principal.scopes.includes(tool.scope)) {
    throw new McpScopeDeniedError(tool.scope);
  }
};

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0;

const parseExpiresAt = (value: unknown): number => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) return parsed;
  }
  throw new Error("MCP_EXTERNAL_CLIENTS 凭证过期时间非法");
};

/** 凭证条目兼容两种写法：字符串凭证，或 { token|value, expires_at|expiresAt } 对象 */
const parseTokenEntry = (entry: unknown): McpClientToken => {
  if (typeof entry === "string") {
    if (!entry) throw new Error("MCP_EXTERNAL_CLIENTS 凭证不能为空");
    return { token: entry };
  }
  if (typeof entry !== "object" || entry === null) {
    throw new Error("MCP_EXTERNAL_CLIENTS 凭证条目格式非法");
  }
  const raw = entry as Record<string, unknown>;
  const token = isNonEmptyString(raw.token) ? raw.token : raw.value;
  if (!isNonEmptyString(token)) throw new Error("MCP_EXTERNAL_CLIENTS 凭证条目缺 token");
  const expiresRaw = raw.expires_at ?? raw.expiresAt;
  if (expiresRaw === undefined) return { token };
  return { token, expiresAt: parseExpiresAt(expiresRaw) };
};

/** 从环境变量解析客户端配置；兼容旧单 token 格式，非法配置启动即失败 */
export const loadMcpClients = (raw: string | undefined): McpClientConfig[] => {
  if (!raw) return [];
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed)) throw new Error("MCP_EXTERNAL_CLIENTS 必须为 JSON 数组");
  const names = new Set<string>();
  const tokens = new Set<string>();
  const externalKeys = new Set<string>();
  return parsed.map((item: unknown) => {
    if (typeof item !== "object" || item === null) {
      throw new Error("MCP_EXTERNAL_CLIENTS 条目必须为对象");
    }
    const config = item as Record<string, unknown>;
    if (!isNonEmptyString(config.name) || !Array.isArray(config.scopes)
      || !config.scopes.every(scope => MCP_TOOL_SCOPES.includes(scope as McpToolScope))) {
      throw new Error("MCP_EXTERNAL_CLIENTS 条目缺 name/scopes 或 scope 非法");
    }
    if (config.token !== undefined && config.tokens !== undefined) {
      throw new Error("MCP_EXTERNAL_CLIENTS 条目不能同时配置 token 与 tokens");
    }
    // 旧格式 token 等价于只有一个凭证的 tokens
    const rawTokens = config.tokens !== undefined
      ? config.tokens
      : (config.token !== undefined ? [config.token] : undefined);
    if (!Array.isArray(rawTokens) || rawTokens.length === 0
      || rawTokens.length > MAX_TOKENS_PER_CLIENT) {
      throw new Error(`MCP_EXTERNAL_CLIENTS 每客户端需配置 1～${MAX_TOKENS_PER_CLIENT} 个凭证`);
    }
    const parsedTokens = rawTokens.map(parseTokenEntry);
    const externalKey = config.external_key ?? parsedTokens[0].token;
    if (!isNonEmptyString(externalKey)) {
      throw new Error("MCP_EXTERNAL_CLIENTS 外部密钥不能为空");
    }
    if (names.has(config.name)) throw new Error("MCP 客户端名称重复");
    if (externalKeys.has(externalKey)) throw new Error("MCP 客户端外部密钥重复");
    for (const candidate of parsedTokens) {
      if (tokens.has(candidate.token)) throw new Error("MCP 客户端凭证重复");
      tokens.add(candidate.token);
    }
    names.add(config.name as string);
    externalKeys.add(externalKey);
    return {
      name: config.name as string,
      scopes: [...config.scopes] as string[],
      tokens: parsedTokens,
      externalKey,
    };
  });
};
