// MCP 会话工厂（T-17 N-02）：每次请求一组独立 Server + Streamable HTTP transport
//（无状态模式，服务间集成的推荐形态）；close 释放传输与会话。
import type { IncomingMessage, ServerResponse } from "node:http";

import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

import { type McpCallAudit } from "./audit.js";
import { type McpClientPrincipal } from "./policy.js";
import { type McpToolRegistry } from "./registry.js";
import { attachMcpToolHandlers } from "./server.js";

export interface McpSession {
  handleRequest: (req: IncomingMessage, res: ServerResponse) => Promise<void>;
  close: () => Promise<void>;
}

export interface McpSessionFactoryDeps {
  registry: McpToolRegistry;
  audit?: McpCallAudit;
}

/** 工厂在启动时构造一次；每请求以配置映射出的 principal 建独立会话 */
export const createMcpSessionFactory = (
  deps: McpSessionFactoryDeps,
) => {
  return async (principal: McpClientPrincipal): Promise<McpSession> => {
    const server = attachMcpToolHandlers({
      registry: deps.registry, principal, audit: deps.audit,
    });
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });
    await server.connect(transport);
    return {
      handleRequest: (req, res) => transport.handleRequest(req, res),
      close: async () => {
        await transport.close();
        await server.close();
      },
    };
  };
};
