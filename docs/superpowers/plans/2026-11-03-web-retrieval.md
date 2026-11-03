# 网络检索与依赖升级实施计划

**Goal:** 将角色受控的搜索/网页工具接入回答前流程，升级兼容依赖并验证推送。

**Architecture:** 请求级工具闭包保存本次搜索来源；固定Tavily接口负责搜索，固定DNS的有界HTTP客户端负责页面获取，agent-browser read只接收一次性本地正文。沿用既有网关、计划预算、来源检查和审计，不改变后台治理工具集。

**Tech Stack:** Node24、AI SDK7、Workflow5.3、agent-browser0.41.1、undici、ipaddr.js。

## 约束

业务数据仍只经FastAPI访问；Workflow仍最多5轮并逐项审批。无外部密钥默认不展示搜索工具；浏览器只读、无登录/点击/脚本/上传/下载接口。保留用户既有GL工作区内容，不访问生产数据库。

## W-01 配套依赖

- [x] 更新Agent package/lock、Node24 CI、Nitro/Rollup兼容版本及runtime说明；核对serde配套版本与既有故障规避。
- [x] 相关治理序列化/工具权限冒烟、类型/lint验证后小提交。

## W-02 工具与网络边界

- [x] 新建tests/web-retrieval.test.ts、web-fetch.test.ts、browser-reader.test.ts反例：缺省关闭、角色/上下文、非法URL、私网与DNS重绑定、重定向、限流/超量/超时/取消、结果串用与凭据隔离。
- [x] 新建src/web/{config,public-fetch,search,browser-reader,tools}.ts分离配置、网络、搜索、CLI和请求级工具。
- [x] Tavily HTTP协议替身和真实CLI本地读取验证，相关检查通过后提交。

## W-03 回答接线与来源

- [x] 公共只读能力集中至role-capabilities，新增tools/request-tools统一请求级工厂供chat/tasks入口使用；两工具共用AgentTool，三角色继承并按角色/任务取交集。
- [x] 来源校验反例及真实聊天HTTP替身覆盖：检索先于回答、有效外链可引用、编造外链失败、不授予学生写/治理权限。
- [x] Linux Node24全量、lint/typecheck/build、Workflow/dev及独立产物网络/PG冒烟；更新README/依赖说明/审查记录、tasks/analyze，选择性提交并推送。
