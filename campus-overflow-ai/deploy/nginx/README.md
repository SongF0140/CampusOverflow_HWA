# Nginx

生产统一入口（T-18 v4 修订，2026-10-14）。**路由口径以前端 BFF 为准**，依据
`docs/前端架构/前端服务需求文档.md` §1/§4.3：浏览器只调同源地址，登录态与
`x-trace-id` 由 Next.js 的 Route Handler 注入。

Expected routing:

- `/` -> frontend:3000（**包含** `/api/backend/**` 与 `/api/agent/**`，
  一并交给前端 BFF 转发）
- `/docs/api` -> backend OpenAPI docs（可选，默认关闭，仅内网/管理网段）

**禁止的规则**：

- 不设 `/api/` -> backend 的直连规则：会绕过 BFF 的登录态注入与 trace 透传，
  等同于让浏览器直连 FastAPI（与 `next.config` 废弃 rewrites 是同一个坑）。
- backend:8000 与 agent:8787 不对公网暴露。
- `/internal/agent/*` 绝不对外（宪法 C-05 服务间白名单，仅允许 Agent 服务访问）。
