import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 禁止 next dev 自动生成 frontend/AGENTS.md 与 CLAUDE.md（AI 指引统一由根目录 AGENTS.md 提供）
  agentRules: false,
  // 注意：不要再加 /api/backend/** 与 /api/agent/** 的 rewrites。
  // Next.js 的 afterFiles rewrites 会抢在动态 Route Handler 之前执行，一旦配置，
  // src/app/api/backend/[...path]/route.ts 与 .../agent/[...path]/route.ts 就变成死代码，
  // BFF 的登录态注入（HttpOnly Cookie → Authorization）、x-trace-id 透传将全部失效。
  // 转发统一由上述两个 Route Handler 负责（见 docs/前端架构/前端服务需求文档.md §4.3）。
};

export default nextConfig;
