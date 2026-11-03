# 巡检409分类与回调端口修复计划

**Goal:** 未知/可重试409保留扫描页，回调目标与Nitro实际端口一致，并固化真实HTTP路由反例。

**Architecture:** 为已确认消失/隐藏/删除的巡检目标增加专用领域异常与可选reason_code；现有错误信封及其他错误不变。Agent仅识别根任务创建接口的已知原因码，不以HTTP状态或中文文案判断跳过。共享无副作用的Nitro端口解析模块供预加载器和回调运行配置使用；直接运行产物遵循Nitro优先级，标准启动仍保留AGENT_PORT及8787默认。

**Tech Stack:** FastAPI/pytest、Node24/Vitest、Hono/Nitro/Workflow。

## 约束

JWT认证、任务UUID、审批、5轮预算及数据库职责不变；不访问生产库，不改变路由顺序以修复未发生的遮蔽问题，不纳入用户原有GL改动。

## P-01 分类与路由

- [x] 先补后端已隐藏/软删/不存在目标专用原因码、未知状态/其他409无原因码反例；完整应用真实TCP验证/scan/page、缺段路径及UUID资源路由。
- [x] Agent错误客户端只读取根创建接口的白名单原因码；调度未知409保留本页，明确不可巡检可确认，混合页失败不前移。
- [x] 后端相关pytest/ruff/分层、Agent相关测试/typecheck/lint，通过后提交。

## P-02 端口与运行验收

- [x] 先补NITRO_PORT/PORT冲突、标准AGENT_PORT、直接启动默认及非法/冲突配置反例。
- [x] 新增scripts/listen-port.mjs与类型声明：Nitro解析使用NITRO_PORT→PORT→3000；标准预加载规范化AGENT_PORT并维持8787默认。回调不再仅使用PORT；不支持的Unix socket/动态HTTP端口明确拒绝。
- [x] 真实Nitro产物启动组合与回调HTTP验证，补CI运行冒烟；复核既有运行与治理回归，记录限制与结果后本地提交。新一批推送依用户指令，不部署。
