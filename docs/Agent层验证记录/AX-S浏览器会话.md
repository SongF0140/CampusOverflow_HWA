# AX-S 浏览器逻辑会话与渐进记忆

日期：2026-10-28。本子模块实现验证完成；总入口接线由本批父任务统一完成。

2026-10-29 接线补记：registerSessionRoutes已在认证中间件后注册，chat session_id/history严格校验并仅装配回答；三个角色页面共用账号隔离会话。最终集成与全量结果见2026-10-29增量收口记录。

## 设计依据与决策

- 读取 AGENTS、宪法 C-07、Memory M-D01/M-D02/M-D04/M-D05/M-D07、现有 browser-memory 与 /assistant 聊天契约。
- 复用 /assistant，不创建第二个聊天产品入口；“＋”新建 UUID 逻辑会话，与单次 run ID 分离。
- 历史保存在当前浏览器按账号命名空间；同账号至多 20 个会话，每会话最近 100 条。不跨设备同步，服务器没有持久保存这些私聊历史。
- 个人记忆继续手动维护、AI 只读。索引（50×36 字）、摘要摘录（5×100 字）、详情（3×500 字）是三个独立 HTTP 请求，实际逐步披露；最终聊天仅携带所选详情。不是先上传全量后做界面折叠。
- 选择用确定性文字相关性和长期偏好优先，适用于个人记忆装配；不替代教材 RAG 混合/向量检索，不产生新标签。
- 请求中的 owner_id 必须等于后端已验证 principal；session_id 不授予权限。浏览器命名空间隔离是产品约束，不声称抵御同源恶意脚本或用户自行修改 localStorage。
- 历史仅 user/assistant，最多 20 条、单条 2000 字、总 8000 字；只进入回答参考，不能进共享记忆、工具授权、模型规划或审计正文。
- 换号通过 keyed 子组件卸载，中止旧请求；切换会话、清空当前会话、记忆变化/清空、跨标签页 storage 通知均中止在途。代际标识阻止迟到回复回写其他会话。

## 验证记录

- Agent 新逻辑与前端会话存储先出现缺模块的失败；前端新增“＋”、旧响应隔离测试先 2 failed/4 passed，失败原因是旧页面缺新会话按钮。
- Agent：`node node_modules/vitest/vitest.mjs run tests/memory-disclosure.test.ts tests/memory-disclosure-route.test.ts`，2 文件 7 passed。
- 前端：`node node_modules/vitest/vitest.mjs run src/features/agent-chat/browser-sessions.test.ts src/api/agent-chat.test.ts src/features/agent-assist/AssistantChatView.test.tsx src/shared/lib/browser-memory.test.ts`，4 文件 26 passed。
- 前端全服务 tsc --noEmit 通过，Agent tsc --noEmit 通过；涉及源码和测试的 eslint 通过。
- 覆盖账号/会话隔离、历史预算、索引全文拒绝、额外字段拒绝、重复/未知 ID 拒绝、三个请求逐步增加正文、清空记忆和切换账号取消、迟到响应不回写、新会话不复制历史、原 SSE 成功/失败协议。
- 开始运行测试时 sandbox 拒绝 Vitest worker 的 spawn（EPERM）；以允许的 Vitest 前缀重跑后完成真实反例与通过验证，不将环境启动失败算作功能红灯。

## 限制

- 这里的摘要是受限摘录，不声称模型已自动生成长期摘要；AI 不自动新增、更新、删除个人记忆。
- 浏览器清空不能撤回已经发送给模型的内容；会中止在途并阻止后续请求再注入已删除条目。已显示的旧聊天仍是会话记录，可通过“清空当前会话”删除。
- 无实际外部模型或浏览器端到端人工体验验证；测试使用现有 React/jsdom、真实 SSE 解析和 mock 网络。
- 路由需父任务在受认证的 /agent/* 中间件之后注册；chat.ts 必须按已交付 session/history 契约只装配回答参考。父任务统一记录集成验证。
