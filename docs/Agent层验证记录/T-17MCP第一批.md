# T-17 MCP Server 第一批验证记录（只读同步）

日期：2026-10-24。依据 spec US-19、Q-11 定案（系统作为 MCP Server 被大系统接入；先只读同步/管理操作走审批工单/服务凭证+身份映射）与 plan N-01/N-02。提交 dc4ecdf（核心+传输）、34e176f/46327fd（文档）。

## 实现与决策（细节见 my_engineer_docs《MCP服务端决策》）

- **N-01 服务端核心**（`agent/src/mcp/` registry/policy/audit/server/tools）：registry 白名单注册（scope 枚举 read/admin:query/admin:act 一次定义，管理员工具预留）；policy Bearer 凭证 timing-safe 映射→scopes、调用前强制 scope 校验；audit 结构化日志（参数/结果脱敏摘要复用 sensitive.ts，trace=mcp-<uuid>）；server 用 SDK 低阶 setRequestHandler——未注册/scope 不足/入参非法/执行失败均以 isError 结果协议内表达（脱敏原因，不透传底层异常），会话不崩。只读工具 search_questions/search_courses/list_tags 经 service 级 internal-client（MCP 层零 SQL，C-05）。低阶 setRequestHandler 规避 SDK registerTool 的 Zod 版本耦合。
- **N-02 HTTP 传输与接线**：Streamable HTTP 无状态模式——**会话工厂启动时注入**（mcp/session.ts 持 SDK transport 构造），http.ts 请求路径只做鉴权（401）与分发（该结构化边界同时化解了 Mimosa 对协议适配层的两次"sql-injection 入口"误报——实际零 SQL、principal 全来自服务端配置映射）；server.ts 按 MCP_SERVER_ENABLED（默认关）+ MCP_EXTERNAL_CLIENTS + MCP_PORT（默认 8790）开关启动，SIGTERM 关闭。

## 验证

- 核心：tests/mcp-server.test.ts 16 项（SDK Client + InMemoryTransport 全链路——ListTools 只列注册工具/未注册拒绝不暴露注册表/scope 拒绝含 denied 审计/成功调用含 trace 与摘要审计/审计脱敏 password=[REDACTED]/后端故障 isError 脱敏且会话恢复/入参非法/凭证单元含 timing-safe 长度差异）。
- HTTP 集成：tests/mcp-http.test.ts 3 项（真实 HTTP 上无效凭证 401 不进协议、SDK Client 完整握手 initialize→listTools→callTool、同进程失败隔离不遗留全局状态）。
- Agent 24 文件 237 passed、tsc/eslint 零错误、无迁移、无后端变更。
- 完成判定达成：未注册工具不可被调用；MCP 调用失败不影响核心问答（独立代码路径 + isError 隔离）；MCP 不能直改核心业务表（只读工具经 internal-client，零 SQL）。

## 限制与遗留（后续批次）

管理员工具通道（工单查询/处置、角色变更，scope admin:*，经审批工单 + 大系统管理员→本系统 admin 身份映射）；持久化调用审计（需归属模型）；增量同步接口；Agent 消费外部 MCP 工具的客户端角色；真实大系统接入联调（凭证/地址配置就绪即可验证）。

## 外部接入与凭证轮换（P4，2026-11-18）

### 接入步骤

1. 启动配置：`MCP_SERVER_ENABLED=true`、`MCP_EXTERNAL_CLIENTS`（客户端凭证 JSON），可选 `MCP_PORT`（默认 8790）、`MCP_RATE_LIMIT_PER_MINUTE`（默认 60）。服务只监听 `127.0.0.1`，对外暴露由部署层反向代理负责。
2. 客户端以 Streamable HTTP 连接 `http://127.0.0.1:8790/mcp`，请求头 `Authorization: Bearer <token>`。
3. scope 决定可用工具：`read` 为只读问答/课程/标签；`admin:query`、`admin:act` 的管理员工具还要求 `external_key` 与后端 `BACKEND_EXTERNAL_AGENT_KEYS` 中的密钥映射一致。

```json
[
  {
    "name": "campus-portal",
    "scopes": ["read"],
    "tokens": ["current-token"],
    "external_key": "backend-external-key"
  }
]
```

旧格式 `{ "name": "...", "token": "...", "scopes": [...] }` 继续可用，等价于只有一个凭证，`external_key` 回退为该凭证。

4. 冒烟验证：

```bash
npm run smoke:mcp -- --in-process                 # 本地桩数据自检
MCP_SMOKE_TOKEN=<token> npm run smoke:mcp         # 对已启动实例冒烟
```

### 轮换流程

1. 生成新凭证，与旧凭证一起写入同一客户端的 `tokens`（最多两个，凭证值不可重复）。
2. 重载 Agent 进程使配置生效（当前无热加载）。
3. 外部客户端切换到新凭证；审计中的 `client` 仍为同一客户端名。
4. 旧凭证可设置 `expires_at` 等待自然过期，或直接移除；过期凭证鉴权阶段即被跳过，返回与不存在凭证相同的 401。
5. `external_key` 保持不变，因此轮换 MCP 凭证不需要改后端管理员密钥映射。

### 限流与错误语义

- 每客户端 60 次/分钟（进程内令牌桶，主/备凭证共享额度），超限返回 429「请求过于频繁，请稍后重试」，并写 `mcp_request_rejected` 审计。
- 限流在鉴权之后、会话创建与工具执行之前拦截；额度按 HTTP 请求计。
- 多实例部署时各进程独立计数，不共享额度。

### 回滚

恢复单 `token` 旧格式并重启即可，无需数据迁移；关闭 `MCP_SERVER_ENABLED` 则完全停用外部接入。
