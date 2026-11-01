# WF-02 Workflow 与 Hono/Node 构建启动实施计划

> **For agentic workers:** 在当前会话使用 executing-plans 与 TDD，不启动子Agent；本块完成验证提交后按AGENTS.md等待人工审查。

**Goal:** 在保留Hono接口、8787端口和后台服务行为的前提下接入Workflow编译与Nitro启动，验证真实工作流步骤可在本地执行。

**Architecture:** src/server.ts仅导出Hono app；Nitro runtime plugin管理进程级后台资源。独立生命周期对象保证并发启动只执行一次，关闭等待初始化且只执行一次，初始化失败回滚已启动资源。Workflow内部入口默认关闭，冒烟使用专用fixture和临时数据目录，无业务或模型调用。

**Tech Stack:** workflow=5.2.3、@ai-sdk/workflow=2.0.91、ai=7.0.159、nitro=3.0.261029-rc、rollup=4.67.3；Node>=22.22.0。

## Global Constraints

- C-05：MySQL业务只经FastAPI；Postgres仅Workflow运行存储，Markdown/Wiki仅知识参考。无真实数据库操作、迁移或部署。
- WF-01完整loop最多5轮语义不变；本块不接模型治理闭环，也不迁移学生聊天。
- 保持Hono既有路由与身份/审计行为、AGENT_PORT兼容和8787默认端口。
- Workflow业务入口默认关闭，生产运行/存储和内部路由保护在完整验收前不启用。
- 只提交本块变更，保留原有GL验收工作区变更。

## 文件边界

- Modify: agent/package.json、package-lock.json、tsconfig.json、.gitignore、eslint.config.js；新增nitro.config.ts。
- Modify: agent/src/server.ts；Create: agent/src/runtime/background-services.ts、agent/src/runtime/agent-services.ts、agent/src/runtime/mcp-service.ts、agent/plugins/background.ts。
- Create: agent/scripts/runtime-env.mjs、agent/middleware/workflow-access.ts、agent/src/runtime/workflow-access.ts。
- Tests: agent/tests/background-services.test.ts、knowledge-service.test.ts、workflow-access.test.ts、runtime-env.test.ts；agent/tests/fixtures/workflow-runtime/的probe与仅测试注册的路由；agent/scripts/smoke-workflow.mjs和smoke-dev.mjs。
- Docs: 宪法、plan/tasks/analyze、AGENTS、.trae/rules/conventions.md、README/依赖说明/Agent运行说明与WF-02审查记录；CI增加Agent类型、构建和运行冒烟。

## 执行步骤

- [x] 先写生命周期反例：并发start只初始化一次、close等待在途启动、重复close不重复清理、启动失败逆序回滚、清理失败不漏其他资源。接口为createBackgroundServices(starters)，返回start()/close()。

```ts
const start = vi.fn(async () => stop);
const runtime = createBackgroundServices([start]);
await Promise.all([runtime.start(), runtime.start()]);
await Promise.all([runtime.close(), runtime.close()]);
expect(start).toHaveBeenCalledTimes(1);
expect(stop).toHaveBeenCalledTimes(1);
```

- [x] 新增内部路由开关与端口环境预加载反例：默认404；生产不允许Local World；AGENT_PORT和NITRO_PORT一致；无配置默认8787。运行相关Vitest确认缺失能力红灯。
- [x] 安装锁定依赖；@ai-sdk/workflow依赖ai 7.0.159，同步root ai避免双版本。新增Nitro配置module=workflow/nitro，catchall=src/server.ts，preset=node-server。
- [x] 实现生命周期并迁移原server后台接线，Nitro plugin注册close hook；MCP启动失败继续原有脱敏日志语义，迟到MCP句柄也必须关闭。Hono模块仅创建路由，不启动HTTP/MCP/定时器。
- [x] dev/build/start改为Nitro与Node生成入口；scripts/runtime-env.mjs加载dotenv并设置PORT/NITRO_PORT，AGENT_PORT优先，默认8787；忽略.output/.nitro/.workflow-data和生成代码。
- [x] 使用隔离fixture编译一个真实use workflow/use step探针，步骤仅创建WF-01检查点并验证WorkflowAgent导出。冒烟脚本以随机空闲端口、关闭现有后台能力、临时Local World启动生成服务，验证health、未登录chat拒绝、内部路由默认关闭及探针结果，再清理自建进程。
- [x] 执行相关测试、Agent tsc/eslint、实际nitro build与smoke；再验证dev模式可用且退出清理。配置CI相同检查，不声称未运行的远端CI通过。
- [x] 回填结果和限制、C-05变更理由及WF-01用户批准；按文件/任务hunk暂存，本地提交feat: 接入Workflow与Hono运行生命周期。

## 验证命令

工作目录campus-overflow-ai/agent：npm test -- tests/background-services.test.ts tests/knowledge-service.test.ts tests/workflow-access.test.ts tests/runtime-env.test.ts tests/health.test.ts tests/user-auth.test.ts tests/governance-loop-state.test.ts tests/governance-executor.test.ts tests/mcp-http.test.ts tests/weekly-report-scheduler.test.ts tests/moderation-patrol.test.ts；npm run typecheck；npm run lint；npm run build；npm run smoke:workflow；npm run smoke:dev。

自审：接口/生命周期由行为测试验证，编译与真实步骤执行由冒烟验证；不测试实现字符串，不启动真实业务或模型。Postgres生产运行不在本块启用，不把构建通过等同完整治理交付。
