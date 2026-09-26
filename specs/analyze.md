# 一致性分析报告（Analyze）

> 状态：2026-09-22 执行第六轮分析（分层架构基线变更：每模块新增 domain.py 纯规则层 + ORM 不上浮 + DomainError 收口；identity 试点改造完成，pytest 31 全绿 + ruff 零 error + lint-imports 三契约全 KEPT）。此前 2026-09-20 第五轮（骨架改造对齐架构文档 + 前后端接口对接定案 + 蛇形字段/优质内容认证两项决策落定）
> 命令：`/speckit.analyze`
> 定位："返工预防器"——在 implement 之前检查 spec / plan / tasks 三者一致性，尤其适合中大型项目。

## 分析范围

- specs/spec.md（版本：v3，2026-09-20 角色模型调整：助教并入学生端 + 研究生助教能力位；Agent 服务与治理逻辑标注第二阶段）
- specs/plan.md（版本：v3，2026-09-20 需求覆盖映射更新 + 范围调整注 + 后端目录权威指向 docs/后端架构说明.md；本轮小改：二期模块表述与 Agent 预留文档指向）
- specs/tasks.md（版本：v2 + 2026-09-20 增补 2：T-05 新增优质内容认证接口 POST/DELETE /api/answers/{id}/certify）
- specs/constitution.md（版本：v1，2026-09-03 补充 C-06~C-08）
- 代码现状（2026-09-20 骨架改造后）：backend 6 模块 3.5 层结构 + Alembic 骨架 + governance 占位；frontend 三端路由 + BFF 骨架
- 接口对接依据：docs/前端后端接口对照表.md（D1~D16 / F1~F3 全部闭环）、docs/后端架构/ 三端接口文档、docs/前端架构/前端服务需求文档 §4.1

## 检查结论

| 编号 | 类型 | 描述 | 严重度 | 修复去向 |
| ---- | ---- | ---- | ------ | -------- |
| A-01~A-08 | 已修复 | 历史三轮分析结论（spec/plan/tasks 填充、宪法补全、术语统一、v2 游客裁剪联动等），详见 2026-09-18 第三轮报告记录，均已闭环 | — | 已闭环 |
| A-09 | 已修复 | 2026-09-20 角色模型调整：助教不恢复为独立角色，并入学生端——研究生身份 + 助教认证通过 → 助教能力位。spec v3 新增 US-20（P0）、E-12、E-13、Q-07；plan v3 映射 US-20 → identity（身份字段 + require_graduate_assistant）+ qa（推荐标记）；tasks v2 插入 T-02a（研究生身份与助教能力位，依赖 T-02）、T-05 增补助教推荐标记（仅展示标记，不影响采纳权） | 高 | 已闭环 |
| A-10 | 已修复 | 2026-09-20 范围调整（Q-08）：本期只做业务后端，Agent 服务不搭建。tasks v2 将 T-11~T-17 整体标注第二阶段；T-18 收窄为一期部署范围（backend + MySQL）；T-19/T-20 标注一期自检范围；`/internal/agent/*` 仅保留前缀注释与 TODO 事件钩子；governance 治理逻辑仅建表 + 501 占位；AGENTS.md、README.md 与 docs 范围注释已同步 | 高 | 已闭环 |
| A-11 | 提示 | tasks v2 的 T-03~T-10 描述中残留前端页面完成判定（课程页区块、详情页展示等），不在本期实施范围——随第二阶段前端实现一并验收；执行以 tasks.md 头部"一期实施范围总注"为准 | 低 | 第二阶段启动时随前端任务重述 |
| A-12 | 提示 | 优质内容认证接口（T-05 增补 2，`POST/DELETE /api/answers/{id}/certify`）：spec 无独立用户故事行，但功能概述明确"教师认证优质内容"、E-06 明确"认证越权拒绝"，spec 依据充分；判定为覆盖成立。建议后续 specify 时在 US-10 或新 US 中显式化故事描述 | 低 | 随下次 specify 显式化；T-05 实施时回填 plan 第 5 节接口表 |
| A-13 | 提示 | 治理占位路由前缀 `/api/governance/*`（一期 501）与二期落地路径 `/api/admin/moderation/*`、`/api/admin/approvals/*`、`/api/admin/appeals/*` 不同——已在 docs/前端后端接口对照表.md §0 定案（占位仅一期形态，T-15 实施时按 /api/admin/* 落地并迁移占位） | 低 | T-15 实施时迁移占位路由 |
| A-14 | 已修复 | 字段命名定案（2026-09-20）：接口字段一律蛇形（page_size 等），TS 代码内部仍 camelCase。接口设计指南、开发协作流程文档、学生端 / 教师端接口文档示例、前端服务需求文档 §3.3、AGENTS.md 已全部同步；已实现代码（T-02）与 422→400 归一测试断言一致 | 中 | 已闭环 |
| A-15 | 已修复 | 骨架改造与架构文档一致性：backend 与 docs/后端架构说明.md §7 一致（identity 已实现、governance 建表 + 501 占位、其余模块占位、Alembic env 就绪、app/shared 与实验 tasks 模块删除）；frontend 与 docs/前端架构/前端服务需求文档 §3 路由树一致（三端路由 + BFF api/backend、api/agent）；过时引用（骨架分析第 9 节、agent_gateway、modules/{auth,users}）已在全部有效文档清理，pytest 24 项全绿 + ruff 零 error | 中 | 已闭环 |
| A-16 | 已修复 | 2026-09-22 分层架构基线变更（用户定调"domain/service 为基座、低耦合"）：①每模块新增 domain.py（纯规则、零框架依赖、设计后冻结）——spec/plan 不受影响（纯 HOW 层变更，规则仍由 E-01~E-13 承载）；②ORM 不上浮：models 仅被本模块 repository import，service 出入参一律 schemas（新增 UserAuthInternal 内部模型）；③service 不再抛 HTTPException，改抛 DomainError（core/domain_error.py 纯基类 + core/errors.py 统一映射，BizException 废除）；④pyproject 增加 import-linter 三契约（domain 零框架 / service+router 禁触 models / repository 禁 fastapi）。identity 已试点改造，courses/qa/interaction 建 6 文件占位 stub；后端架构说明.md v3、AGENTS.md、分层架构设计基线.md 已同步。T-03+ 施工作业新增要求：实现 repository 后须在契约 ignore_imports 补 "x.repository → x.models" 行 | 中 | 已闭环；T-03 起按新标准施工并同步契约 |

## spec ↔ plan ↔ tasks 覆盖核对（分阶段）

### 第一期（本期实施：业务后端）

- US-02~US-10、US-15 → T-02（已完成）、T-03~T-10（后端部分 + pytest）
- US-20（研究生助教板块）→ T-02a（identity 身份字段 + `require_graduate_assistant`）+ T-05 增补（qa 助教推荐标记，E-13）
- 功能概述"教师认证优质内容" + E-06 认证越权 → T-05 增补 2（certify 接口，A-12）
- E-12 → 后端侧由 T-02a 验收（403 拒绝）；前端不出现入口的表现随二期
- US-13 / US-14 的数据结构 → governance 建表 + 501 占位（已随骨架改造落库）；业务逻辑延后
- US-16 封禁部分 → T-02 已完成（管理员直接执行 + 审计日志）；申诉部分延后（学生侧 POST /api/appeals 已在接口文档定义，二期 T-15 实现）
- 宪法映射：C-02 → 全部后端任务；C-03 → T-19（一期范围）；C-06 一期形态 = 管理员直接执行 + 审计；C-07/C-08 一期形态 = 表结构 + 占位预留（ModerationCase/Appeal 已含 trace_id、agent_run_id 字段位）

### 第二期（Agent 服务与治理逻辑、前端页面）

- US-11~US-14（业务逻辑）、US-16（申诉）、US-17~US-19 → T-11~T-17
- 前端页面与 E-12 入口表现、E-13 展示标记呈现、/api/users/me/memories（T-14）、/api/admin/agent/runs（T-16）→ 二期前端任务（启动时重述并重跑本分析）
- 宪法映射：C-05 → T-11/T-12；C-06 AI 工单化 → T-15；C-07 → T-14；C-08 → T-16；C-01/C-04 → 前端实现与 T-20 补检

## 修复循环规则

1. 需求冲突 → 修改 spec.md，必要时重跑 clarify。
2. 技术不可行 → 修改 plan.md。
3. 任务覆盖不足 → 重新生成 tasks.md。
4. 修复后重新执行 analyze，直到"无重大冲突"才可进入 implement。

## 最终判定

- [x] 第一期（业务后端）无重大冲突，允许进入 `/speckit.implement`（A-11/A-12/A-13 为低严重度提示，均已记录去向；T-02a 与 T-03 起按 Phase 顺序执行）
- [ ] 第二阶段启动前必须重跑本分析（届时以重述后的前端/Agent 任务核对 spec v3 全量故事）
