// MCP 客户端凭证与 scope 策略（T-17 N-01，Q-11③）：
// 大系统持专属服务凭证（token → scopes 绑定）；调用允许当且仅当工具 scope
// 在客户端 scopes 内。比对 timing-safe，不依赖提示词（统一策略代码强制）。
import { timingSafeEqual } from "node:crypto";

import { type McpToolDefinition } from "./registry.js";

export interface McpClientConfig {
  /** 大系统专属凭证（Bearer token） */
  token: string;
  /** 客户端名（审计用，如 "campus-portal"） */
  name: string;
  /** 权限范围：read / admin:query / admin:act */
  scopes: string[];
}

export interface McpClientPrincipal {
  name: string;
  scopes: readonly string[];
}

const BEARER_PREFIX = "bearer ";

/** 从 Authorization 头解析客户端身份；无效/缺失返回 null（401） */
export const authenticateClient = (
  authorization: string | undefined,
  clients: readonly McpClientConfig[],
): McpClientPrincipal | null => {
  if (!authorization) return null;
  const trimmed = authorization.trim();
  if (trimmed.length <= BEARER_PREFIX.length) return null;
  if (trimmed.slice(0, BEARER_PREFIX.length).toLowerCase() !== BEARER_PREFIX) return null;
  const token = trimmed.slice(BEARER_PREFIX.length).trim();
  if (!token) return null;
  const tokenBytes = Buffer.from(token);
  for (const client of clients) {
    const expected = Buffer.from(client.token);
    if (expected.length === tokenBytes.length && timingSafeEqual(expected, tokenBytes)) {
      return { name: client.name, scopes: [...client.scopes] };
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

/** 从环境变量解析客户端配置（MCP_EXTERNAL_CLIENTS = JSON 数组）；非法配置启动即失败 */
export const loadMcpClients = (raw: string | undefined): McpClientConfig[] => {
  if (!raw) return [];
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed)) throw new Error("MCP_EXTERNAL_CLIENTS 必须为 JSON 数组");
  return parsed.map((item) => {
    const config = item as Partial<McpClientConfig>;
    if (typeof config.token !== "string" || !config.token
      || typeof config.name !== "string" || !config.name
      || !Array.isArray(config.scopes)) {
      throw new Error("MCP_EXTERNAL_CLIENTS 条目缺 token/name/scopes");
    }
    return { token: config.token, name: config.name, scopes: [...config.scopes] };
  });
};
