# AX-C 主 Agent 共享记忆与权限验证

日期：2026-10-28。独立模块完成；实际聊天/工具接线由父任务执行并另验。

2026-10-29 接线补记：教师发布API/审核页、共享上下文、计划工具与角色助手均已接入。规则/目录/经验更新共同改变上下文版本；认证答案锚点和审批入口逐个校验。用户修订为学生只读、教师/管理员受人工确认写能力，旧“固定只读名单”表述仅描述当时模块边界；当前角色交集与验证见增量收口记录。真实模型自主选择披露仍未联调。

## 设计依据

Memory M-D07/M-D08/M-D09、AX-R08、宪法 C-05/C-07；已读 AGENTS、Memory/RAG 设计与工具注册/执行器。主 Agent 不汇总私人记忆或聊天，不让模型规则替代后端身份校验。

## 实现与工程决策

- `memory/main-context.ts`：只读管理员受控规则文件、Zod 严格字段边界、SHA-256 版本；共享结构仅 tool_rules、skills、兼容 experiences 与 certified_answers。未知字段或私聊字段拒绝，损坏规则不降级为默认允许。
- `discloseMainMemory`：领域与认证卡片按当前课程过滤；首层只给条目索引/标题，选中的第二层才给摘要，第三层才给 skill 正文/经验流程。字段边界不等于同主机访问控制，文件维护者仍须是受控管理员。
- `resolveCertifiedLink`：卡片没有持久可信 URL；当前用户客户端必须回源验证认证、可见性、课程/问题/回答 ID，再披露后端提供的本地回答定位链接。外部地址、目标错配、隐藏或撤销认证均拒绝。
- `agents/controller.ts`：子 Agent 工具集是主规则允许、后端当前角色权限、固定只读名单的交集。fetchModerationTarget 保留既有普通用户读取可见正文用途，由后端可见性授权；不能仅凭名字将其误判为治理执行。未知/写入/非 low 风险工具拒绝，禁止子 Agent 注册工具。
- 工具展示和每次执行重读规则；旧 `getTool.execute` 或旧 SDK 工具引用也重验，执行时再次读取基础工具风险。上下文不能替换绑定账号/角色，后端每次 API 调用仍负责当前权限复核。
- 用户本轮明确经验由 Agent 提交建议、老师确认发布。`discloseMainMemory` 第五参数接后端 publishedExperiences，严格限定 id/course_id/status=published/title/summary/steps，按课程过滤；草案或额外工具规则字段拒绝。文件中的旧 experiences 不作为教师审批证明，不进入披露；父任务负责后端审核/发布接口，不能由 Agent 直接改规则文件。

## 验证记录

- 首次运行确认因缺 controller 模块失败，然后实现。
- `node node_modules/vitest/vitest.mjs run tests/main-agent-control.test.ts tests/knowledge-catalog.test.ts`：2 文件 30 passed，本模块 15 项、AX-K 15 项。
- `node node_modules/typescript/bin/tsc --noEmit` 与相关模块 ESLint 最终复验通过。
- 覆盖受控文件稳定/变化版本、私有字段拒绝、三层披露、课程过滤、认证撤销/隐藏/链接错配、角色上限、未知/写/高风险工具、禁止注册、规则收紧、旧引用/SDK 不旁路、执行身份替换、损坏规则失败关闭、基础工具风险变化。

## 限制

- 尚不代表真实模型会自行发起逐层披露；实际路由/模型工具接线、教师发布 API 和上下文预算由父任务集成。
- READ_TOOLS 是确定性程序白名单，增加新只读工具需修改受控代码，不能仅添加文件规则。
- 账号降权仍由后端请求即时核验；本地 bound principal 是请求归属，不能缓存为长期授权。
