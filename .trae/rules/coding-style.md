# 编码风格规则

> 状态：v1（2026-09-03）
> 适用范围：Next.js 前端、FastAPI 后端、TypeScript Agent 服务。

## 通用规则

- 代码优先保持小而清晰，遵循现有目录和命名风格。
- 用户可见文案使用简体中文；日志、错误码、变量名使用英文。
- 不提交密钥、token、Cookie、数据库密码、LLM API Key。
- 新增跨服务能力时必须同时考虑鉴权、trace id、错误处理和测试。
- 不让 Agent 绕过 FastAPI 直接访问 MySQL 或执行核心业务写入。
- 注释只解释复杂意图，不重复代码表面含义。

## TypeScript 通用风格

- 使用 TypeScript strict 模式，避免 `any`；确需使用时说明原因并限制作用域。
- 优先 `const`，必要时使用 `let`，禁止 `var`。
- 函数和变量使用 `camelCase`；组件和类使用 `PascalCase`；常量使用 `UPPER_SNAKE_CASE`。
- 布尔变量以 `is`、`has`、`can`、`should` 开头。
- 使用 `interface` 描述对象结构，使用 `type` 描述联合类型、字面量枚举和工具类型。
- API 边界、LLM structured output、工具参数必须用 Zod 校验。

## Next.js 前端

- 使用 Next.js App Router，不使用 Pages Router。
- 页面默认使用 Server Components；只有表单交互、浏览器 API、流式 UI、局部状态需要时才加 `"use client"`。
- `src/app/**` 放路由、layout、page、route handler；`src/features/<domain>/` 放业务 UI、hooks、client API 封装。
- `src/app/api/**` 只做 BFF 转发、鉴权上下文传递和 SSE 透传，不写核心业务规则。
- 样式使用 Tailwind CSS，避免行内样式；通用组件放 `src/components/`。
- AI 流式 UI 使用 `@ai-sdk/react`，必须处理 loading、error、retry、approval-needed 状态。

## FastAPI 后端

- 使用 Python 3.11+，Pydantic 模型声明请求/响应，SQLAlchemy 2.x 同步模式访问 MySQL。
- 模块按 `app/modules/<domain>/` 拆分，常规文件为 `models.py`、`schemas.py`、`service.py`、`router.py`。
- Router 只做参数接收、鉴权依赖、响应封装；业务规则、事务和权限判断放 service。
- 数据库结构变更必须走 Alembic migration。
- 所有写操作必须检查当前用户权限；管理员、教师、助教、学生权限不可混写。
- 内部 Agent API 放 `/internal/agent/*`，必须服务间 token 鉴权，并透传 `x-trace-id`。
- 返回格式统一为 `{ code: number, data: T, message: string }`。

## Agent 服务

- 第一阶段采用单 Agent Loop + task router，不实现真实多 Agent；`agent/src/agents/` 仅作为第二阶段扩展点。
- `agent/src/loop/` 放主循环、停止条件、自检逻辑；`agent/src/tasks/` 放任务处理器。
- 工具统一在 `agent/src/tools/registry.ts` 注册，未注册工具不可调用。
- MCP 相关代码放 `agent/src/mcp/`，必须经过 registry、policy、adapter 三层；第一阶段默认使用 mock MCP 工具。
- 记忆读写放 `agent/src/memory/`，只调用 FastAPI 内部接口；写入前后都要考虑敏感信息过滤。
- 高风险动作放 `agent/src/approvals/` 生成审批工单，不直接删帖、封号、隐藏内容或写文件。
- 观测能力放 `agent/src/observability/`，每次 run、tool call、approval request 必须记录 trace id 和摘要。
- 不记录原始 prompt 中的密钥、密码、Cookie、完整隐私原文。

## 测试风格

- 后端测试使用 pytest，测试文件命名 `test_*.py`。
- 前端和 Agent 测试使用 vitest，测试文件命名 `*.test.ts` 或 `*.test.tsx`。
- Agent 测试 mock LLM、mock FastAPI、mock MCP；不要让单元测试依赖真实网络。
- 权限、事务、审批、记忆过滤、工具白名单、trace id 透传属于必须覆盖的高风险路径。
