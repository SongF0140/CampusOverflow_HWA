# RAG 与对比实验

## 检索结构

知识不是等长切块，而是“课程 → 卡片 → 摘要 / 正文”：

```text
课程目录（Markdown）
  └── 卡片：标题 + 摘要 + 正文
        ├── 摘要块：用于快速召回卡片
        └── 正文块：按段落切分，用于取证
```

- 摘要负责“这笔资料讲什么”，正文负责“原话怎么讲”。
- 正文按空行分段，默认单块 1200 字符，避免把一个论证拆散。

## 召回链路

```text
query
  ├── 稠密向量召回（embedding → HNSW）
  └── 关键词召回（中文双字 n-gram + 标识符 → BM25）
        ↓
     RRF 融合（k=60）
        ↓
     候选 N=20 → 取前 K=5
```

| 项 | 默认 | 说明 |
| --- | --- | --- |
| embedding | Qwen / GLM 的 OpenAI 兼容 `/embeddings` | 批量 32、30 秒超时、维度校验 |
| 索引 | HNSW | `M=16`、`efConstruction=200`、`efSearch=64`，内存索引 |
| 关键词 | 中文双字 n-gram + 拉丁标识符 | 错误码、版本号原样匹配加权 |
| 融合 | RRF `k=60` | 不直接相加不同量纲的分数 |
| 开关 | `RAG_ENABLED=false` | 默认关闭 |

## 安全与降级

- 课程在工具闭包内绑定，模型不能通过参数换课程。
- 执行前用用户凭证复核课程资料权限。
- 索引构建失败、检索失败、embedding 超时：记录脱敏摘要并返回空结果，标记降级，不阻断问答。
- 索引缓存键 = 目录版本 + embedding 模型 + 服务地址。

## 为什么需要对比实验

“我的 RAG 更好”不是可验证命题。可验证的是四个子命题：

| 命题 | 比较对象 | 指标 |
| --- | --- | --- |
| H1 | 固定 chunk vs 卡片摘要/正文 | Recall、上下文精度、上下文长度 |
| H2 | 平铺召回 vs 先摘要后展开正文 | 同等预算下的精度与召回 |
| H3 | 单路召回 vs 双路 + RRF | Recall、MRR |
| H4 | Flat vs HNSW | 质量是否对齐、P95 延迟 |

H4 只能证明“质量基本不变、速度变化”，不能宣称质量提升。

## 实验工程

`Cross_testing/` 是独立目录，与 `docs/` 同层：

```bash
cd Cross_testing
npm test          # 切分、映射、指标、统计、六变体自检
npm run rag       # 输出 results/ablation.md 与 .csv
```

- 六个变体共享同一语料、同一批 query、同一 embedding、同一 top-K，一次只改一个变量。
- gold 按**原文 quote** 标注，再映射到各变体的 chunk，保证跨切分可比。
- 统计采用配对比较：bootstrap 95% CI + Wilcoxon 符号秩检验。

## 当前限制

- 对比实验目前用合成 fixture 与确定性哈希向量，只证明管线可运行，**不能作为效果结论**。
- 尚未接入真实 Qwen/GLM embedding，未做 50 题人工标注 pilot。
- 无答案阈值与拒答未实现；HNSW 参数未在真实语料上调优。
- 回答层指标（正确率、引用忠实度、拒答率）尚未实现。

## 相关代码

- 检索实现：`agent/src/knowledge/rag/`
- Agent 工具：`agent/src/tools/search-knowledge.ts`
- 评测脚本：`agent/scripts/rag-eval.mjs`
- 对比实验：`Cross_testing/`
