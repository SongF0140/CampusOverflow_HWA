# 项目约定（Conventions）

> 状态：v1（2026-09-03）
> 范围：目录结构、Git、文档、协作流程、跨服务边界。

## 1. 工作区结构

```text
workplace/
├── .trae/                  # Trae 规则（AI 助手自动加载）
│   └── rules/              # coding-style / conventions / project-context
├── specs/                  # 规格驱动文档（constitution/spec/plan/tasks/analyze）
├── docs/                   # 流程与说明文档
├── campus-overflow-ai/     # 项目代码总目录
│   ├── frontend/           # Next.js 16 App Router 前端
│   ├── backend/            # FastAPI 业务后端
│   ├── agent/              # TypeScript Agent 服务
│   ├── deploy/             # 部署配置
│   ├── scripts/            # 辅助脚本
│   └── tests/              # 跨服务端到端测试
└── README.md
```

代码只放在 `campus-overflow-ai/` 下；需求、设计、依赖、骨架分析等说明写入 `docs/`；可执行规格写入 `specs/`；AI 助手规则写入 `.trae/rules/`。

## 2. Git 与提交

- 分支命名使用 `feat/<短描述>`、`fix/<短描述>`、`docs/<短描述>`、`chore/<短描述>`。
- 提交信息格式为 `<type>: <简短中文描述>`，type 限定为 `feat`、`fix`、`docs`、`refactor`、`test`、`chore`。
- 不提交 `.env`、密钥、数据库 dump、日志文件和构建产物。
- 提交前至少保证本次改动所属服务的 lint 与测试通过；跨服务改动需说明尚未验证的服务。

## 3. 文档与规格

- `docs/需求文档.md` 写业务目标、角色、功能、非功能需求。
- `docs/设计文档.md` 写架构、模块、接口、数据模型、安全、部署、测试策略。
- `docs/项目骨架分析.md` 写目录职责、端口、模块边界和后续落地路径。
- `docs/依赖说明.md` 写每个服务的依赖、为什么选、是否第一阶段必需。
- `specs/spec.md` 是 WHAT 层，描述用户故事和验收口径；不要塞实现细节。
- `specs/plan.md` 是 HOW 层，描述技术选型、接口、数据、目录、风险。
- `specs/tasks.md` 是执行层，任务必须能逐项落地并对应 spec/plan。
- 修改架构或技术选型时，同步检查 README、docs、specs、`.trae/rules` 四处是否一致。
- 所有项目文档使用简体中文，术语保持一致：业务后端、Agent 服务、Agent Loop、内部白名单接口、审批工单、持久化记忆。

## 4. 服务边界

- Next.js 负责前端体验、App Router 页面、BFF 转发和 AI 流式 UI。
- FastAPI 负责认证、RBAC、核心 CRUD、事务、一致性、审计和 MySQL 访问。
- Agent 服务负责单 Agent Loop、task router、tool calling、structured output、streaming、自检、MCP Adapter、记忆读写编排。
- Agent 不直接连接 MySQL，不绕过 FastAPI 执行业务写入。
- 高风险动作（隐藏内容、删帖、封号、文件写入、外部 MCP 调用）必须生成审批工单，由 FastAPI 在人工确认后执行。
- Redis 是可选增强，不作为第一阶段强依赖。

## 5. UI/UX

- 界面文案使用简体中文。
- 学生端与管理员/教师后台是同一 Next.js 应用的不同路由和权限视图，不拆成两个前端项目。
- 学生端优先支持浏览问题、提问、回答、评论、投票、采纳、标签与相似问题推荐。
- 后台优先支持用户管理、课程管理、内容审核、审批工单、Agent 运行记录和封禁申诉。
- 交互页面必须提供加载、空状态、错误状态；涉及 AI 流式输出时必须能显示生成中、失败重试和人工确认。
- 视觉风格清爽现代，避免大面积蓝紫渐变和“AI 产品模板感”。

## 6. 测试与验收

- 后端核心业务用 pytest，覆盖认证、权限、问答、投票、采纳、审批、记忆权限。
- 前端和 Agent 用 vitest，覆盖 hooks、工具注册、task router、MCP 策略、结构化输出解析。
- Agent 测试默认 mock 模型和 mock MCP，不依赖真实外部 LLM 才能通过。
- 每个任务完成后更新 `specs/tasks.md` 勾选状态，并在必要时回填 `specs/analyze.md`。
