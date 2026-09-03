import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 业务后端与 Agent 服务通过 rewrites 代理，前端代码统一走相对路径
  async rewrites() {
    return [
      { source: "/api/backend/:path*", destination: "http://localhost:8000/api/:path*" },
      { source: "/api/agent/:path*", destination: "http://localhost:8787/agent/:path*" },
    ];
  },
};

export default nextConfig;
