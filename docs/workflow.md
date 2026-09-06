# 标准化流程（Spec-Driven Workflow）

> 本项目采用"规格驱动开发"：文档先行、逐级递进、一致性把关，最后落地代码。

## 命令总览

| 命令 | 作用 | 产出 |
| ---- | ---- | ---- |
| `/speckit.constitution` | 定义项目不可协商原则 | constitution.md |
| `/speckit.specify` | 用业务语言写需求（WHAT） | spec.md |
| `/speckit.clarify` | 对模糊点提问并补齐边界 | 更新后的 spec.md |
| `/speckit.plan` | 生成技术方案（HOW） | plan.md / 数据模型等 |
| `/speckit.tasks` | 任务拆解与执行顺序 | tasks.md |
| `/speckit.analyze` | 检查 spec/plan/tasks 一致性 | 分析报告（analyze.md） |
| `/speckit.implement` | 按任务顺序落地代码 | 可运行代码 |
| `/spec <任务号>` | 快捷方式，等价于 `/speckit.implement <任务号>` | 可运行代码 |

强调：

- **specify 阶段只谈需求**，不抢跑到实现细节。
- **clarify 虽可选，但强烈建议执行**。
- **analyze 是"返工预防器"**，尤其适合中大型项目。

## 快捷命令 /spec

`/spec <任务号> [补充说明]` 是 `/speckit.implement` 的固定快捷方式。Agent 收到后按以下默认约定执行，无需每次重复输入：

- **默认上下文**：`AGENTS.md`（硬性约束 1~8）、`specs/`（constitution/spec/plan/tasks/analyze）；`docs/` 按需查阅，不要求全量读取。
- **执行目标**：以 `specs/tasks.md` 中该任务的目标与完成判定为准；括号内的补充说明可细化目标，但不得违反宪法（constitution.md）。
- **执行边界**：只修改该任务涉及的模块目录及对应测试；超出范围的改动必须先说明理由并征得同意。
- **收尾动作**：完成后勾选 `specs/tasks.md` 对应任务并写一行结果；若实现中回改了 spec/plan/tasks，必须重跑 `/speckit.analyze` 后才能继续实现。

示例（推荐写法）：

```text
/spec T-02（用户注册登录与角色权限，US-02、E-07/E-08）
```

等价于完整写法：

```text
/speckit.implement T-02（用户注册登录与角色权限，US-02、E-07/E-08）
上下文：specs/spec.md（US-02、E-07/E-08）、specs/plan.md 第 4/5 节、docs/设计文档.md 权限矩阵
约束：遵守 AGENTS.md 硬性约束 1~8；只动 backend/app/modules/{users,auth} 和 tests
验收：pytest 覆盖认证与权限边界；ruff check 零 error
收尾：完成后勾选 specs/tasks.md 的 T-02 并写一行结果
```

## 七步标准化流程

### Step 1：制定宪法（Constitution）

- **你要输入**：项目底线规则（质量、风格、安全、边界）
- **系统产出**：`specs/constitution.md`
- **验收标准**：至少 5 条"可检查"的规则（不是口号）
- **不通过就这样改**：把"代码要规范"改为"必须通过 ESLint 且无 error"这类可执行描述

### Step 2：创建功能规约（Specify）

- **你要输入**：用户要完成的任务、场景、结果（只写 WHAT）
- **系统产出**：`specs/spec.md`
- **验收标准**：包含主流程、边界条件、异常场景
- **不通过就这样改**：删除技术实现细节，改写为"用户行为 + 系统反馈"

### Step 3：澄清需求（Clarify）

- **你要输入**：对关键问题的明确回答（默认值、边界、冲突优先级）
- **系统产出**：补全后的 `specs/spec.md`
- **验收标准**：关键歧义问题已关闭（如空值、排序、删除策略）
- **不通过就这样改**：对每个问题给出"明确规则 + 示例"

### Step 4：生成技术方案（Plan）

- **你要输入**：技术偏好、约束条件、非功能要求（性能/可维护性）
- **系统产出**：`specs/plan.md`（可含数据模型、接口草案）
- **验收标准**：方案能完整覆盖 spec.md 的核心需求
- **不通过就这样改**：先补齐缺失模块，再重跑 plan

### Step 5：生成任务清单（Tasks）

- **你要输入**：按实现顺序的拆解要求
- **系统产出**：`specs/tasks.md`
- **验收标准**：每个任务都有目标与完成判定，且可按顺序执行
- **不通过就这样改**：拆分过大的任务，补上验收动作

### Step 6：一致性检查（Analyze）

- **你要输入**：对 spec / plan / tasks 做一致性分析
- **系统产出**：`specs/analyze.md`（冲突/遗漏分析结果）
- **验收标准**：无重大冲突（需求缺失、方案冲突、任务覆盖不足）
- **不通过就这样改**：
  - 需求冲突 → 回改 spec.md
  - 技术不可行 → 回改 plan.md
  - 任务覆盖不足 → 重生 tasks.md

### Step 7：自动实现（Implement）

- **你要输入**：按任务顺序执行实现
- **系统产出**：可运行代码
- **验收标准**：主流程可演示，关键边界可验证
- **不通过就这样改**：回到对应上游文档修正后再实现

## 执行路径

```text
constitution → specify → clarify → plan → tasks → analyze → implement
```

## 文件结构

```text
workplace/
├── .trae/
│   └── rules/
│       ├── coding-style.md     # 代码风格规则（可检查）
│       ├── conventions.md      # 项目约定（目录/Git/文档/UI/测试）
│       └── project-context.md  # 项目上下文速览
├── specs/
│   ├── constitution.md         # 项目宪法
│   ├── spec.md                 # 需求规格（WHAT）
│   ├── plan.md                 # 技术方案（HOW）
│   ├── tasks.md                # 任务清单
│   └── analyze.md              # 一致性分析报告
├── docs/
│   └── workflow.md             # 本文件：标准化流程
├── campus-overflow-ai/         # 项目代码总目录（frontend/backend/agent/deploy/...）
└── README.md
```

## 常见问题

**Q: 如何修改任务优先级？**
A: 直接编辑 `specs/tasks.md`，调整任务顺序后重新执行 `/speckit.implement`。

**Q: 如何中途暂停实现？**
A: 在 `/speckit.implement` 执行过程中直接打断对话，下次使用 `/speckit.implement --continue` 继续。

**Q: 什么时候必须重跑 analyze？**
A: spec.md、plan.md 或 tasks.md 任何一处发生修改后，进入 implement 前都应重跑。
