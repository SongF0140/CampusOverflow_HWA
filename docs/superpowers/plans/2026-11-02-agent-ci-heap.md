# Agent CI构建堆内存修复

用户在推送后反馈Agent正式构建因V8堆耗尽退出134。日志在约2023MB存活堆处OOM；此前本地Node24默认堆约4288MB，未覆盖CI使用的约2GB限制。前面的Nitro/Zod/node:sqlite警告不是本次进程终止原因。

已读AGENTS.md、当前specs/plan/tasks/analyze、Agent配置与CI，以及systematic-debugging/gh-fix-ci流程。GitHub CLI未安装，连接器读取该仓库Actions返回404；以用户日志及本地受限堆复现验证，不宣称已读取远端完整结果。

修复范围：只为Agent CI job设置NODE_OPTIONS=--max-old-space-size=4096，使正式构建、Workflow冒烟、Nitro开发worker及子进程共享显式构建预算。保持Node22、依赖版本、业务运行设置和现有检查不变，不以跳过构建或压制警告解决。执行2GB复现与4GB构建/两种冒烟，记录结果后提交至当前分支；远端可读时复核CI。
