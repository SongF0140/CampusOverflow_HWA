# 项目约定（Conventions）

> 状态：模板（待填充）
> 范围：目录结构、Git、文档、协作流程等约定。

## 1. 目录结构约定

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

## 2. Git 约定

- [ ] 分支命名：`feat/xxx`、`fix/xxx`、`docs/xxx`
- [ ] 提交信息格式：`<type>: <描述>`（type ∈ feat/fix/docs/refactor/test/chore）
- [ ] 禁止直接提交到 main 分支，必须走 PR
- [ ] 每次提交前通过 lint 与测试

## 3. 文档约定

- [ ] 需求只写 WHAT（spec.md），不写实现细节
- [ ] 技术方案只写在 plan.md
- [ ] 文档变更与代码变更在同一 PR 中提交
- [ ] 所有文档使用简体中文

## 4. UI/UX 约定（如适用）

- [ ] 界面文案使用简体中文
- [ ] 禁用"AI 味"蓝紫渐变，采用清新简洁风格
- [ ] 交互必须有加载/空/错误三种状态

## 5. 测试约定

- [ ] 核心流程必须有单元测试
- [ ] 测试文件命名：`*.test.ts`（或选定：____）
- [ ] 提交前测试必须全部通过
