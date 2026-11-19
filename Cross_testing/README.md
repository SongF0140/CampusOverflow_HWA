# Cross-testing：RAG 切分与检索策略对比

本目录用于回答一个具体问题：**卡片式“摘要 + 正文”结构，相比传统固定窗口 chunk RAG，究竟在哪一层带来收益？**

它不是效果排行榜，而是一套可复现的对照实验。所有变体共享同一份语料、同一批 query、同一 embedding、同一 top-K 与同一指标；一次只改变一个结构变量。

## 1. 实验命题

| 编号 | 命题 | 判定指标 |
| --- | --- | --- |
| H1 | 卡片摘要/正文结构比固定 chunk 召回更准或上下文更省 | Recall@K、上下文精度、上下文字符 |
| H2 | 先摘要召回卡片、再展开正文，比平铺 chunk 更精 | 同等预算下上下文精度、Recall |
| H3 | 稠密 + 关键词 + RRF 比单路召回更稳 | Recall@K、MRR |
| H4 | HNSW 只影响速度，不牺牲质量 | 与 Flat 的 Recall 对齐、P95 延迟 |

H4 是“质量对齐 + 延迟收益”，不是质量创新。近似索引不应被描述成召回提升。

## 2. 变体

| 变体 | 切分 | 召回 | 索引 | 用途 |
| --- | --- | --- | --- | --- |
| `fixed-dense-flat` | 固定窗口 180 字、45 字 overlap | 稠密 | Flat | 传统 chunk RAG 基线 |
| `card-dense-flat` | 卡片摘要与正文分别成块 | 稠密 | Flat | 只验证“结构切分” |
| `card-hybrid-flat` | 同上 | 稠密 + BM25 + RRF | Flat | 验证混合召回 |
| `card-hierarchical-flat` | 摘要为检索单元，正文为展开单元 | 稠密 | Flat | 验证分层检索 |
| `card-hierarchical-hybrid-flat` | 同上 | 稠密 + BM25 + RRF | Flat | 分层 + 混合 |
| `card-hybrid-hnsw` | 卡片块 | 稠密 + BM25 + RRF | HNSW | 验证近似索引质量对齐 |

## 3. 数据格式

gold 按**原文 quote**标注，而不是按某个变体的 chunk id 标注。这样同一份数据可以映射到固定 chunk、摘要块和正文块。

```json
{
  "documents": [
    {
      "id": "db",
      "course_id": 1,
      "title": "数据库系统",
      "cards": [
        { "id": "db-deadlock", "title": "死锁", "summary": "...", "body": "..." }
      ]
    }
  ],
  "queries": [
    {
      "id": "q01",
      "query": "如何预防死锁",
      "type": "single_fact",
      "gold": [{ "quote": "按固定顺序加锁" }]
    }
  ]
}
```

映射规则：先判 quote 是否被 chunk 文本包含；跨 chunk 边界时用双字重合率 ≥ 0.6 兜底。多 gold 题要求所有 quote 都被覆盖才算“全证据”。

## 4. 指标

检索层：

- Recall@K：gold quote 被 top-K 覆盖的比例；
- 全证据率：所有 gold quote 都进入上下文的比例；
- MRR：第一个相关片段的名次倒数；
- 上下文精度：top-K 中相关片段占比；
- 上下文字符：本次检索拼进上下文的字符数；
- P95 延迟；
- 无答案命中率：无答案题仍返回内容的比率。

回答层（当前未实现，需真实模型与人工抽检）：正确率、引用忠实度、完整率、拒答率、每题 token 成本。不要把检索指标当成回答质量。

## 5. 统计

- 配对比较：同一 query 上“变体减基线”；
- bootstrap 10,000 次，报 95% CI；
- Wilcoxon 符号秩检验，小样本 p 值为近似值；
- 多指标比较时应做 Holm-Bonferroni 校正（当前脚本未自动校正，需在报告中说明）。

## 6. 运行

依赖复用 `campus-overflow-ai/agent` 的 `tsx`，本目录不需要单独 `npm install`。

```bash
cd Cross_testing
npm test          # 8 项自检：切分、映射、指标、统计、六个变体
npm run rag       # 默认跑 datasets/rag-gold.fixture.json，输出 results/ablation.md 与 .csv
```

真实数据集：

```bash
cd Cross_testing
npm run rag -- --dataset path/to/rag-gold-50.json --top-k 5
```

结果写入 `results/`，该目录不入库。

## 7. 如何解读

- 先看 `Recall@K` 是否不降，再看上下文精度与字符数是否下降；
- 如果卡片结构 Recall 持平但上下文字符显著下降，说明它赢在“同等证据更省上下文”；
- 如果 HNSW 的 Recall 与 Flat 对齐、P95 下降，才能写“索引加速”；
- 任何合成 fixture 的结果都只能证明管线可运行，不能证明设计有效。

## 8. 限制

- 当前 fixture 是合成数据与确定性哈希向量，不能作为质量结论；
- 尚未接真实 Qwen/GLM embedding；
- 尚未实现回答层指标与 LLM 裁判；
- 尚未做 50 题人工标注、dev/test 划分与 Holm-Bonferroni 校正；
- HNSW 参数未针对真实语料调优。
