# MCP 外部接入沙箱

这是外部 MCP 客户端的隔离示例，不是生产部署方案。

## 启动

```bash
cd campus-overflow-ai/deploy/mcp-sandbox
$env:MCP_EXTERNAL_CLIENTS='[{"name":"demo","token":"demo-token","scopes":["read:qa"]}]'
$env:AGENT_SERVICE_TOKEN='<后端服务 token>'
docker compose up --build
```

服务只监听 `127.0.0.1:8790`，对外暴露应由反向代理负责。

## 隔离项

- 非 root（`user: 1000:1000`）；
- 根文件系统只读，`/tmp` 使用 `noexec,nosuid` 的 tmpfs；
- `cap_drop: ALL` 与 `no-new-privileges`；
- CPU、内存、PID 上限；
- 不注入 `DB_*`、`MYSQL_*` 等数据库变量；
- 只注册现有只读工具，不开放写工具。

## 仍需在生产边界处理

- 出站网络白名单：Compose 的 bridge 默认允许出站，生产需用防火墙或代理限制到 FastAPI 与必要的 MCP 上游；
- `AGENT_SERVICE_TOKEN` 与 MCP 客户端 token 应使用 secret 文件或编排平台密钥，不写进 compose；
- 多实例下限流桶不共享，归 T-18 统一收敛；
- 该镜像未在 CI 中构建，示例参数需按实际 Node/Agent 构建产物调整。
