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
