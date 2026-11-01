# Workflow入口

WF-02已接入Workflow编译器与Hono/Nitro启动。此目录用于后续WF-03治理持久流程，当前没有生产workflow函数。内部运行入口默认关闭，生产运行需完成Postgres与路由保护验收后启用。

五轮业务语义使用`../loop/governance-loop-state.ts`；SDK单个step/tool次数不代表完整治理轮次。测试探针位于tests/fixtures/workflow-runtime，仅隔离冒烟构建包含它。
