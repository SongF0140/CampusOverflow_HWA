import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 禁止 next dev 自动生成 frontend/AGENTS.md 与 CLAUDE.md（AI 指引统一由根目录 AGENTS.md 提供）
  agentRules: false,
  // 业务后端与 Agent 服务通过 rewrites 代理，前端代码统一走相对路径
  async rewrites() {
    return [
      { source: "/api/backend/:path*", destination: "http://localhost:8000/api/:path*" },
      { source: "/api/agent/:path*", destination: "http://localhost:8787/agent/:path*" },
    ];
  },
};

export default nextConfig;
