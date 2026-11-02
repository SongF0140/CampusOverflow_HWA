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

workflow 5.2.3、@ai-sdk/workflow 2.0.91、ai 7.0.159、@workflow/world-postgres 5.0.5配套锁定。Nitro 3.0.261029-rc与Rollup负责构建，保留PG/Graphile运行文件。src/workflows/governance.ts运行模型规划→逐次人工审批→受控执行→重新观察→模型效果评估，最多5轮；一轮最多3个动作，每个动作分别申请审批。独立预算为40个逻辑工具调用、120秒活动时间，审批最长7天，durable sleep等待不累计活动时间。

所有新开关默认关闭。启用治理需Agent GOVERNANCE_WORKFLOW_ENABLED=true、WORKFLOW_RUNTIME_ENABLED=true、WORKFLOW_TARGET_WORLD=@workflow/world-postgres、显式WORKFLOW_POSTGRES_URL，以及后端BACKEND_GOVERNANCE_WORKFLOW_ENABLED=true、BACKEND_GOVERNANCE_EXECUTOR_ENABLED=true。须配置不同的service/executor凭证；MODERATION_PATROL_ENABLED控制巡检调度。旧GOVERNANCE_EXECUTOR_ENABLED仅控制旧worker，其领取清单排除system_patrol。

生产禁止Local World。WORKFLOW_CALLBACK_PORT默认8788，仅绑定127.0.0.1，必须与HTTP端口不同且不对外映射。启动时生成临时能力凭据，只供代理注入；公开/.well-known/workflow拒绝无效凭据，未启用时404。Workflow dashboard关闭。使用专用PG角色/库，先按所锁版本官方bootstrap初始化schema；不使用业务DATABASE_URL作为回退。

MySQL保存业务真值，Markdown/Wiki保存知识参考，独立Postgres用于Workflow状态、队列及必要恢复输入/输出（用户已确认C-05例外）。根任务由后台巡检自动创建，后端固定目标和版本；系统申请没有管理员身份。根任务第一步CAS绑定Workflow run，重复候选不能获得治理动作。未绑定根任务在下一次巡检补偿。当前SDK start没有原子hook参数，因此不保证候选Run条数只有1，但只允许1条进入该根任务治理。租约只在服务端step闭包中使用；模型持久描述符为空，provider密钥在模型step内部读取。

## 本地验证

```sh
npm test -- tests/background-services.test.ts tests/knowledge-service.test.ts tests/workflow-access.test.ts tests/runtime-env.test.ts tests/health.test.ts tests/user-auth.test.ts tests/governance-loop-state.test.ts
npm run smoke:workflow
npm run smoke:dev
```

smoke:workflow使用独立.output-smoke/.nitro-smoke构建和临时Local World数据，探针只创建五轮初始检查点并验证WorkflowAgent导出，不调用模型、业务后端或治理。测试入口仅该fixture构建存在，不包含在正式构建。验证health/鉴权、默认关闭、真实use workflow/use step以及MCP启动一次和关闭端口；临时凭证运行时随机生成。

smoke:dev以独立.nitro-dev-smoke构建并关闭开发服务器，所有业务后台能力关闭。上游Nitro开发worker可能触发关闭超时后的强制清理告警；生产后台资源的关闭另由实际MCP端口释放与生命周期测试验证。Local World只证明本地步骤可运行，不代表生产跨重启/跨实例恢复已验收。

CI配置同样的类型、构建和冒烟检查；本地通过不等同于远端CI已运行。

WF-04的`npm run smoke:governance`需要预先准备独立测试实例和迁移后的库，显式设置WORKFLOW_SMOKE_POSTGRES_URL（仅127.0.0.1:55432）、WORKFLOW_SMOKE_MYSQL_URL（仅127.0.0.1:53306/campus_wf04）。可选WORKFLOW_SMOKE_PG_CTL指定pg_ctl工具，测试会核对项目内.wf04-postgres-test真实目录后在第三轮重启该集群。脚本模拟管理员逐次批准，只在验收构建加入测试入口；生产构建没有这些入口。WORKFLOW_SMOKE_SKIP_BUILD=true仅供已构建产物的本地故障定位。完整证据与限制见docs/审查记录/WF-04持久故障验收/审查记录.md。
