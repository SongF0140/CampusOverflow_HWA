# AP-02A 治理预览 Implementation Plan

**Goal:** 让管理员在确认前看到后端实际状态、拟动作影响与阻止原因，预览不触发写操作。

**Architecture:** Hono 已有用户身份中间件 → 独立 approvals 只读用例 → UserInternalClient → AP-01 后端接口。模型、通用工具执行器、建单与真实处置不参与此路径。

**Tech Stack:** TypeScript strict、Hono、Zod、Vitest；复用项目现有依赖。

## Constraints

三服务分离；只经白名单访问；鉴权取后端身份；字段蛇形；中文文案；子 Agent 工具列表保持只读；本块不提供批准/执行按钮或审批令牌。

## One reviewable task

Files: 新建 agent/src/approvals/{types,policy,preview}.ts、agent/src/routes/approvals.ts 和 agent/tests/approvals-preview.test.ts；修改 agent/src/{app,internal-client}.ts、approvals/README.md。specs/plan.md 的 AP-02A 为完整入参与状态契约依据。

- [x] 先写真实 createApp + createInternalClient 的边界测试，以 mock fetch 代替后端；只允许 principal/state GET，其他请求立刻失败；getModel 调用即失败。
- [x] 运行新测试，入口不存在返回 404，以及客户端方法缺失；40 failed/1 passed，原有未登录拦截已通过。
- [x] 实现严格契约：动作 hide/delete/ban/ban_temp/warn，目标 question/answer/comment/user，正整数 ID，非空原因≤500；临时封禁 1～30 天默认 7，仅该动作接受期限。禁止额外字段及动作目标错配。
- [x] 实现固定 AP-01 请求并校验目标一致与状态组合。没有用户凭证不发请求、不回退。未知格式或错目标作为内部响应错误，不输出伪造事实。
- [x] 实现确定性状态策略、预览组装与路由鉴权；非管理员在查询目标前拒绝。响应 Cache-Control=no-store，返回 trace_id，requires_confirmation=true、executed=false。状态阻止仍返回有效预览，can_request_approval=false。
- [x] 运行 node node_modules/vitest/vitest.mjs run tests/approvals-preview.test.ts tests/user-auth.test.ts tests/user-tools.test.ts tests/integration-run.test.ts；4 文件 66 passed。tsc --noEmit、eslint . 通过。
- [x] 回填 tasks/analyze、AP-02A 验证记录；git diff --check；中文小步提交，按 AGENTS 停在本块审查点。

实现接口：buildGovernancePreview(input, principal, client, traceId) 先验证 admin 与输入，再调用 client.fetchGovernanceTargetState({targetType,targetId}, traceId)，返回事实与程序生成文案。ApprovalPolicyError 仅承载本地 400/403；其他异常复用 toErrorResponse 脱敏映射。

测试中的关键断言：
```typescript
expect(body.data.requires_confirmation).toBe(true);
expect(body.data.executed).toBe(false);
expect(calls.map(call => call.path)).toEqual([
  "/internal/agent/principal",
  "/internal/agent/user/governance-targets/question/7/state",
]);
expect(calls.every(call => call.method === "GET")).toBe(true);
expect(getModel).not.toHaveBeenCalled();
```

提交申请与持久恢复依赖 AP-02B/AP-03，不以本块只读预览代替。
