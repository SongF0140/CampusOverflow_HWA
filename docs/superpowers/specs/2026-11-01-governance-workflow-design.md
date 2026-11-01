# 自治理 Workflow 与五轮效果闭环设计

日期：2026-11-01。用户已批准前述方案，修订轮数为“完整 loop 最多 5 轮，多个动作不相加”，并授权开始。本文落实已批准设计，不重新请求同一授权。

## 目标与轮数定义

治理任务由“观察 → 规划 → 多个动作 → 重新观察 → LLM 效果评估”构成一轮。第一轮从 round=1 开始，仅本轮评估决定继续且未触发停止条件时进入下一轮；第 5 轮仍允许全部阶段，评估后必须成功结束或转人工。工具数、模型调用数、动作重试和审批等待均不直接改变 round。

每个根任务保存 task_id、trace_id、round、revision、phase、等待关联、连续无进展次数、最后评估及全部已用观察引用（最多 5×24 个标识）。该状态不是批准凭证，只接受服务端可信事件。模型评估只含 decision、progress 和 evidence_refs，不能修改轮数、权限或状态。

## 方案取舍与分层

已讨论三种路线：保留原 worker 适合执行单个批准动作；仅 Workflow 适合固定步骤；Workflow + WorkflowAgent 支持用户要求的效果判断与动态续接，因此采用第三种。外层 Workflow 负责持久等待与恢复，WorkflowAgent 负责轮内模型/工具交互，显式状态模块负责五轮业务语义；不把 SDK 的 step/tool 调用次数等同于轮数。

继续使用 Hono 和 Node。官方 Hono 接入通过 Nitro 编译 workflow/step；现有 FastAPI 工单、冻结调用、执行租约与幂等回执继续承担业务权威。工具执行复用统一网关；模型与 MCP 不获得人类批准、租约或高风险执行工具。

## 状态转换（WF-01）

- acting：本轮可观察、规划和执行已获授权动作，工具数量不由轮次模块累计。
- waiting_approval：记录待审引用；只能接收同一引用的可信后端批准结果。批准后回 acting，仍须执行前授权复核；拒绝、到期、取消终止。
- verifying：原动作结果未知；只能核对同一引用，核对成功回 acting；不得提交效果评估或新动作。
- completed：本轮观察支持模型 goal_reached，终态。
- needs_human：第 5 轮未完成、连续两轮无进展、模型 handoff、拒绝、过期或取消，终态。

每个事件带当前 round/revision；处理成功 revision+1，旧事件直接拒绝。evaluate 必须带非空本轮 observation_refs，模型 evidence_refs 非空且为其子集；任一历史轮次已用引用均不能冒充新观察。继续评估保存引用并 round+1；第五轮和停止事件保留当前 round。输入状态、事件和评估使用 Zod strict schema，输出是新状态，不修改原状态。

独立工具与时间预算保留原限制；两轮无进展只在完成效果评估时计数，有进展清零。持久步骤保存 checkpoint，恢复用原 task_id/round/revision；当前模块仅提供可序列化协议，不能自行保证跨进程一致性或识别伪造证据，后续适配器负责可信来源与原子提交。

## 后续接线与边界

WF-02 验证兼容包和 Nitro 构建、端口、MCP/调度生命周期；本地开发存储不能代表生产持久队列。自托管 World 的运行库和 C-05 例外需单独明确后再接真实数据库。

WF-03 将轮内动作与效果判断接入 WorkflowAgent，外层在每轮边界使用 WF-01；审批通知仅触发后端查询。动作未知先查原回执，新动作重新申请，新旧 worker 明确执行所有权。运行与审计关联 task_id/trace_id，不保存 JWT/lease/完整私人聊天。

WF-04 做 5 轮多动作、恢复不清零、审批、未知结果、撤权、审计失败与并发重复事件的故障验收。学生 ToolLoopAgent 独立 CHAT-01，保留现有课程范围、来源审查和 SSE。

## 验证与交付

首块测试覆盖：第五轮成功与未完成、一个轮次跨多个动作、等待恢复同轮、未知先核对、重复/迟到事件、终态拒绝、观察引用约束、无进展停止、序列化与输入不可变。执行相关 vitest、tsc --noEmit、Agent eslint。按 AGENTS.md 每块验证提交后人工审查；不推送、不部署、不执行真实治理。

官方依据（2026-11-01 核对）：

- https://workflow-sdk.dev/docs/getting-started/hono
- https://ai-sdk.dev/v7/docs/agents/workflow-agent
- https://workflow-sdk.dev/worlds/postgres

自审：需求、轮数、停止与授权语义一致；无未定义轮数或审批复用；状态模块与后续运行时交付状态分开。
