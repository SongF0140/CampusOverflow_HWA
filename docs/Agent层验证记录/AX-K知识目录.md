# AX-K 本地知识目录验证

日期：2026-10-28。独立模块完成；服务接线由父任务执行并另验。

## 设计依据

AGENTS、RAG 树 D-003/D-015/D-019/D-020、Memory M-D07/M-D09；用户授权连续实现到 TW-02。卡片只有领域名称、元数据、摘要，正文书签与双向链接；哈希增量＋定期全量核对；课程隔离、后端可信标签，私人上下文不进入共享目录。

## 实现决策

- Node 内置 fs/crypto，JSON 元数据嵌入 Markdown，未增加依赖、数据库或 embedding 实现。JSON 是第一版工程格式，未冒称用户逐项选择。
- 首层索引只披露 id/domain/course_id/tag_ids，第二层 getCard 披露元数据和摘要，第三层 getBody 只披露书签段。
- 受控根目录检查、根外符号链接拒绝、原文只读；变更/删除/不合法来源使旧入口移除。目录完整构建后原子替换，版本回调驱动主 Agent 更新。
- 新增 trustedTags 异步提供器契约，必须由后端可信词表实现；本地 source 字段不能自行证明标签来源或课程权限。所有读接口每次显式传入当前授权课程，getBody 再校验词表与卡片/正文哈希。

## 验证记录

- 首次普通沙箱 Vitest 因 spawn EPERM 未运行测试，换已授权本地工作进程后，确认测试因缺少 catalog 模块失败。
- 首轮 13 项实现后通过；补充陈旧卡片/撤销词表反例，确认旧实现失败，再加入读取前校验。
- `node node_modules/vitest/vitest.mjs run tests/knowledge-catalog.test.ts`：15 passed。
- `node node_modules/typescript/bin/tsc --noEmit`：通过。
- `node node_modules/eslint/bin/eslint.js src/knowledge tests/knowledge-catalog.test.ts`：通过。
- 覆盖课程隔离、三层披露、稳定版本/不重解析、摘要/正文变化、删除、词表失效、未知/跨课程标签、伪造来源、路径逃逸、根外 junction、缺书签/反向链接、卡片多板块、原始资料不被改写、并发刷新复用、变化监听和停止。

## 限制

- 这是目录基础设施，不是完整混合召回、Cross-Encoder、tree_summarize 或 PDF 解析。
- 定期完整扫描读取文件计算哈希，只对变化卡片重解析，尚未引入持久哈希缓存。
- 文件监听可合并/漏事件，由定期核对弥补。目录内资料由受控维护者管理，不宣称抵御同主机恶意进程的并发文件系统替换。
- 真实后端可信标签、可见课程与 HTTP/模型工具接线须在父任务集成验证，不能把模块测试冒称端到端上线。
