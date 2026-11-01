# Agent运行说明

需要Node≥22.22.0。Hono保留业务接口，Nitro接管HTTP服务和Workflow编译；FastAPI仍负责业务身份、权限、审批和执行。

## 开发与构建

在本目录运行：

```sh
npm ci
npm run dev
npm run typecheck
npm run build
npm start
```

dev/start通过scripts/runtime-env.mjs加载.env并统一端口，优先AGENT_PORT，其次NITRO_PORT、PORT，默认8787。构建结果在.output/server/index.mjs，正式部署需携带整个.output目录，在目标操作系统/架构上安装和构建。旧dist/server.js入口不再使用；构建机的Node包/原生模块不能直接跨操作系统复制。

后台知识目录、周报、巡检、旧治理worker和MCP由Nitro插件初始化，每个服务实例仅一套；关闭钩子等待在途启动并释放句柄。多进程/多实例仍需要各任务原有的后端幂等与执行所有权约束，不因进程内单次初始化而变为全局单例。

## Workflow当前边界

workflow 5.2.3、@ai-sdk/workflow 2.0.91、ai 7.0.159配套锁定。Nitro 3.0.261029-rc与Rollup负责构建。生产目录src/workflows尚无治理workflow函数；WF-01提供五轮状态协议，模型治理接线归WF-03。

WORKFLOW_RUNTIME_ENABLED默认关闭，/.well-known/workflow及其子路径返回404。仅在development/test环境显式设为true才能使用本地handler；生产或未指定环境即使误开也返回503。Workflow dashboard关闭。现有GOVERNANCE_EXECUTOR_ENABLED保持其既有含义，不会自动启动新工作流。

MySQL保存业务真值，Markdown/Wiki保存知识参考，独立Postgres用于Workflow状态、队列及必要恢复输入/输出（用户已确认C-05例外）。本块未安装/配置Postgres World，未连接真实数据库；生产World、内部handler访问保护、任务关联、隐私最小化及恢复故障验证在后续接线和验收中落实，不能靠开启开关直接上线。

## 本地验证

```sh
npm test -- tests/background-services.test.ts tests/knowledge-service.test.ts tests/workflow-access.test.ts tests/runtime-env.test.ts tests/health.test.ts tests/user-auth.test.ts tests/governance-loop-state.test.ts
npm run smoke:workflow
npm run smoke:dev
```

smoke:workflow使用独立.output-smoke/.nitro-smoke构建和临时Local World数据，探针只创建五轮初始检查点并验证WorkflowAgent导出，不调用模型、业务后端或治理。测试入口仅该fixture构建存在，不包含在正式构建。验证health/鉴权、默认关闭、真实use workflow/use step以及MCP启动一次和关闭端口；临时凭证运行时随机生成。

smoke:dev以独立.nitro-dev-smoke构建并关闭开发服务器，所有业务后台能力关闭。上游Nitro开发worker可能触发关闭超时后的强制清理告警；生产后台资源的关闭另由实际MCP端口释放与生命周期测试验证。Local World只证明本地步骤可运行，不代表生产跨重启/跨实例恢复已验收。

CI配置同样的类型、构建和冒烟检查；本地通过不等同于远端CI已运行。
