# 一致性分析报告（Analyze）

> 状态：模板（待填充）
> 命令：`/speckit.analyze`
> 定位："返工预防器"——在 implement 之前检查 spec / plan / tasks 三者一致性，尤其适合中大型项目。

## 分析范围

- specs/spec.md（版本：____）
- specs/plan.md（版本：____）
- specs/tasks.md（版本：____）
- specs/constitution.md

## 检查结论

| 编号 | 类型 | 描述 | 严重度 | 修复去向 |
| ---- | ---- | ---- | ------ | -------- |
| A-01 | 需求缺失/冲突 | （示例：spec 提到的筛选在 plan 中无对应模块） | 高 | 回改 spec.md |
| A-02 | 技术不可行 | （待填写） | 高/中/低 | 回改 plan.md |
| A-03 | 任务覆盖不足 | （示例：tasks 未覆盖 spec 的异常场景 X-01） | 中 | 重生 tasks.md |
| A-04 | 歧义描述 | （待填写） | 低 | 回改对应文档 |

## 修复循环规则

1. 需求冲突 → 修改 spec.md，必要时重跑 clarify。
2. 技术不可行 → 修改 plan.md。
3. 任务覆盖不足 → 重新生成 tasks.md。
4. 修复后重新执行 analyze，直到"无重大冲突"才可进入 implement。

## 最终判定

- [ ] 无重大冲突，允许进入 `/speckit.implement`
- [ ] 存在未解决问题（列出：____），禁止进入 implement
