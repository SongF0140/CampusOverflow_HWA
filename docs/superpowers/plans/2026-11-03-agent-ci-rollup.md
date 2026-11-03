# Agent Linux CI Rollup模块图修复计划

**Goal:** 修复正式构建在依赖追踪后出现的Rollup空模块引用，并在Linux Node22验证构建和运行入口。

**Architecture:** 保留现有Hono/Nitro/Workflow和业务安全边界。先以已提交源码、锁文件和4GB堆在WSL2隔离Ubuntu环境重现，通过临时诊断确认具体依赖，再调整最小构建边界；不提交node_modules补丁或以忽略异常掩盖缺失模块。

**Tech Stack:** Node22.22.0、Nitro3.0.261029-rc、Rollup4.67.3、Workflow5.2.3。

## 定位与实施方案

WSL2 Ubuntu/glibc、Node22.22.0、全新npm ci及4GB堆稳定重现同一堆栈；临时诊断定位`@workflow/world-postgres/dist/drizzle/index.js`的`Schema`导入`./schema.js`尚未关联。Nitro externals先this.resolve加载模块，再将命中traceDeps的包外部化，导致此包模块图不一致。最小方案在`agent/nitro.config.ts`添加`noExternals: ["@workflow/world-postgres"]`，让该包代码统一参与打包；现有三个traceDeps全保留，使包内SQL及Graphile运行布局仍复制到产物。撤销临时Rollup诊断后运行真实构建和入口验证；若反例不成立则回到诊断。

## 约束

- 治理仍最多5轮完整loop，审批、业务授权和幂等由FastAPI负责。
- PostgreSQL仅作Workflow运行存储，不连接生产数据库、不部署。
- 保留Agent CI全部检查及显式4GB堆；保留运行时SQL/动态模块所需追踪文件。
- 不提交其他GL文档和用户未提交的tasks变更。

## 单项交付：CI-ROLLUP

- [x] Linux Node22执行全新npm ci和正式build；临时Rollup诊断记录空reexport的模块/来源。
- [x] 根据具体依赖和Nitro解析源码更新最小配置；实施前回写plan并复核analyze。
- [x] 撤掉诊断，运行真实正式build、Workflow和开发入口冒烟、lint/typecheck及Agent回归；另完成源码目录外产物的真实Postgres World冒烟。
- [x] 更新验证记录和tasks，复核diff并准备当前分支提交推送；远端CI不可读时明确未确认远端结果。

上游同类线索：https://github.com/nitrojs/nitro/issues/4471 。只能作为诊断线索，须用本项目模块证据确认。
