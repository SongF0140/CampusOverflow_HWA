# 后端架构（按端拆分视图）

> 状态：v3（2026-09-20）
> 定位：[docs/后端架构说明.md](../后端架构说明.md) 是权威架构文档（模块划分、3.5 层结构、import 规则）；本目录是它的**按端拆分视图**——每端一份接口文档，每条接口按"谁调用 / 传什么 / 回什么 / 错了怎么办"四问描述（docs/接口设计指南.md 模板），文末附接口总览表与一期验收清单；已实现部分以代码为准。Agent 端为预留文档（二期权威来源 `campus-overflow-ai/agent/agent端需求文档.md`）。
> 范围：本期只做业务后端（spec v3 / Q-08）；前端页面为第二阶段；Agent 服务见 [Agent端预留文档](./Agent端预留文档.md)。

## 文档导航

| 文档 | 端 | 角色 / 权限依赖 | 阶段 |
| ---- | -- | ---- | ---- |
| [学生端接口文档](./学生端接口文档.md) | 学生端 | student（+ 助教能力位 `require_graduate_assistant`，仅助教板块） | 一期 |
| [教师端接口文档](./教师端接口文档.md) | 教师端 | teacher（`require_roles(teacher)`） | 一期（审批中心二期） |
| [管理员端接口文档](./管理员端接口文档.md) | 管理员端 | admin（`require_roles(admin)`） | 一期（审批中心 / Agent 审计二期） |
| [Agent端预留文档](./Agent端预留文档.md) | Agent 服务 | 服务间调用（`X-Service-Token`，二期启用） | 二期（一期仅占位） |

## 三端共用同一套模块底座

学生端、教师端、管理员端不拆分服务：共用同一套 6 模块与同一 MySQL，端差异全部收敛在 `app/core/permissions.py` 的权限依赖（`require_roles` / `require_graduate_assistant`）。

| 模块 | 接口前缀 | 学生端 | 教师端 | 管理员端 | Agent（二期） |
| ---- | -------- | ------ | ------ | -------- | ------------ |
| identity | `/api/auth` `/api/users` | 注册登录、资料、我的声誉 | 助教认证审核 | 用户封禁/解禁 | —（二期读用户画像） |
| courses | `/api/courses` | 课程列表/详情/加入 | 课程管理（仅本人课程） | —（课程治理二期） | 课程上下文（内部接口） |
| qa | `/api/questions` `/api/answers` `/api/comments` `/api/tags` | 提问/回答/采纳/评论/标签 | 课程问答区 | 软删内容追溯 | 相似问题检索（内部接口） |
| interaction | `/api/votes` `/api/reputation` `/api/notifications` | 投票/声誉/通知 | — | — | — |
| discovery | `/api/search` | 搜索与筛选 | 学习热点（纯读） | — | 候选集检索（内部接口） |
| governance | `/api/governance`（一期 501 占位） | — | 审批中心（二期） | 审批中心 / Agent 审计（二期） | 创建工单（内部接口，二期） |

## 共同约定

- 统一响应 `{ code, data, message }`；错误码仅 200/400/401/403/404/500 六种。
- 接口路径以 `plan.md` 第 5 节为权威；每条接口按"谁调用 / 传什么 / 回什么 / 错了怎么办"四问补全后回填 plan。
- 事务边界只在 service 层；跨模块协作由 service 显式函数调用完成。
- 界面文案简体中文（一期落实为接口错误消息与 OpenAPI 描述文案）。
