// MCP Streamable HTTP 传输（T-17 N-02，Q-11①）：外部大系统经 HTTP 接入的唯一入口。
// 无状态模式（每个 POST 独立 transport+server 实例）；每请求先鉴权（无效凭证 401），
// 再生成 trace 进入调用审计。挂在独立端口（默认 8790），由 MCP_SERVER_ENABLED 开关控制。
import http, { type IncomingMessage, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";

import { type McpCallAudit } from "./audit.js";
import {
  authenticateClient,
  type McpClientConfig,
  type McpClientPrincipal,
} from "./policy.js";

/** 会话工厂：启动时注入（由 server 接线模块用注册表与审计实现），请求路径只查用 */
export type McpSessionFactory = (principal: McpClientPrincipal) => Promise<{
  handleRequest: (req: IncomingMessage, res: ServerResponse) => Promise<void>;
  close: () => Promise<void>;
}>;

export interface McpHttpDeps {
  clients: readonly McpClientConfig[];
  sessionFactory: McpSessionFactory;
  audit?: McpCallAudit;
}

const writeJson = (res: ServerResponse, status: number, payload: unknown): void => {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(payload));
};

/** 每请求处理：鉴权 → 每请求 server/transport 实例（无状态）→ 交给传输层 */
export const createMcpHttpHandler = (
  deps: McpHttpDeps,
): ((req: IncomingMessage, res: ServerResponse) => Promise<void>) => {
  return async (req, res) => {
    const principal: McpClientPrincipal | null = authenticateClient(
      req.headers.authorization, deps.clients,
    );
    if (!principal) {
      // US-19 / Q-11③：凭证缺失或无效一律 401，不暴露任何能力信息
      writeJson(res, 401, { code: 401, data: null, message: "MCP 凭证缺失或无效" });
      return;
    }
    // principal 字段全部来自服务端配置（token 仅用于比对，不进入后续数据流）
    const session = await deps.sessionFactory({
      name: principal.name, scopes: [...principal.scopes],
    });
    try {
      await session.handleRequest(req, res);
    } finally {
      await session.close();
    }
  };
};

export interface McpHttpServerHandle {
  close: () => Promise<void>;
  port: number;
}

/** 启动独立 HTTP 服务（测试传 port 0 由系统分配）；返回可等待的关闭句柄 */
export const startMcpHttpServer = async (
  deps: McpHttpDeps, port: number,
): Promise<McpHttpServerHandle> => {
  const handler = createMcpHttpHandler(deps);
  const server = http.createServer((req, res) => {
    handler(req, res).catch((error) => {
      // 兜底：传输层之外的意外异常按统一信封 500，不泄漏堆栈
      writeJson(res, 500, { code: 500, data: null, message: "MCP 服务内部错误" });
      console.error(JSON.stringify({
        event: "mcp_http_unexpected_error",
        trace_id: `mcp-${randomUUID()}`,
        reason: error instanceof Error ? error.name : "unknown",
      }));
    });
  });
  await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));
  const address = server.address();
  const boundPort = typeof address === "object" && address !== null ? address.port : port;
  return {
    port: boundPort,
    close: () => new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    }),
  };
};
