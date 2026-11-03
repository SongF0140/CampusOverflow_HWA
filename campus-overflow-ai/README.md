# CampusOverflow AI 代码目录

项目当前架构、角色权限、功能进度与验证证据见 [根 README](../README.md)。此目录包含三服务实现及部署辅助文件。

| 目录 | 职责 |
| --- | --- |
| `frontend/` | Next.js 三端页面、BFF 转发和 AI 对话界面 |
| `backend/` | FastAPI 身份权限、问答业务、审批执行、事务及 MySQL 访问 |
| `agent/` | Hono/Nitro Agent、受控工具、MCP、后台调度及 Workflow 持久治理 |
| `deploy/` | 当前业务后端/MySQL Compose；完整三服务及 Workflow 存储部署仍需补齐 |
| `scripts/` | 开发、验证和部署辅助脚本 |
| `tests/` | 跨服务验证相关资料与测试 |

MySQL 保存业务真值，Markdown/Wiki 保存知识参考，独立 PostgreSQL 只保存 Workflow 状态、队列和必要恢复数据。Agent 访问业务数据必须经过 FastAPI 白名单接口。

学生的 Agent 可在回答前使用白名单内、且符合其角色和数据范围权限的只读与网络检索工具，不开放写操作或自治理。自治理属于管理端及受控后台巡检，高风险动作逐项人工审批。已有只读工具和回答前规划链路，网络检索接线及角色/范围验收仍归 CHAT-01，详见根 README。

开发和构建从根 README 的命令开始；Workflow 开关、回调代理及运行存储配置见 [Agent 运行说明](./agent/README.md)。
