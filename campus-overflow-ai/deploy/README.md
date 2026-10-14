# Deploy Structure（T-18 v4，2026-10-14 已落地）

生产形态 = MySQL + backend + agent + frontend + nginx，只有 `nginx:80` 对公网开放。

| 文件 | 状态 | 说明 |
| ---- | ---- | ---- |
| `docker-compose.prod.yml` | ✅ | 五服务编排，含 healthcheck；敏感项走 `.env`，未设置则 compose 报错 |
| `backend.Dockerfile` | ✅ | 启动时 `alembic upgrade head && uvicorn` |
| `frontend.Dockerfile` | ✅ | 多阶段 + Next `output: "standalone"` |
| `agent.Dockerfile` | ✅ | `tsc` 构建后 `npm prune --omit=dev` |
| `nginx/nginx.conf` | ✅ | **BFF 优先**：`/` → frontend，不设 `/api/` → backend 直连 |
| `.env.example` | ✅ | 复制为 `deploy/.env` 后逐项填写 |
| `mysql/`、`redis/` | 占位 | mysql 初始化由镜像 + compose 变量完成；Redis 不在本期范围（Q-04） |

## 用法

```bash
cd campus-overflow-ai
cp deploy/.env.example deploy/.env && vi deploy/.env   # 必须覆盖全部 change-me 项
docker compose -f deploy/docker-compose.prod.yml up -d --build
curl http://localhost/api/agent/health                  # 走 nginx → frontend BFF 聚合（注意 /api/agent/** 前缀）
```

## 硬性口径

- 路由以前端 BFF 为准（`docs/前端架构/前端服务需求文档.md` §1/§4.3），nginx 不得把
  `/api/` 直连 FastAPI，否则绕过登录态注入与 `x-trace-id` 透传。
- backend:8000 与 agent:8787 不对公网暴露；`/internal/agent/*` 绝不对外（宪法 C-05）。
- Agent 服务本次 release 已停用 AI 端点（`/agent/chat`、`/agent/tasks/:type` 注释停用），
  仅健康检查可用，故 `OPENAI_*` 可留空。
- 目标机 `myserver` 仅 1.9 GiB 内存，资源约束与降级方案见 `specs/plan.md` §9.3。
