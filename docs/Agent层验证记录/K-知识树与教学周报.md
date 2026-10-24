# K-01~K-05 知识树与教学周报实现验证（KN-R01~03）

日期：2026-10-23/24。依据 spec 2026-10-23 节、Q-09 四项决策、plan 顶部增量方案与 tasks K 系列清单。用户授权"继续完成编码和运行测试"。真实模型联调与真实 MySQL 并发单列为限制（同 G-06 口径）；三处提交（文档、K-01/K-02 后端）均被 Mimosa commit 钩子以既有测试文件 fixture 密码（12 个历史文件、非本轮改动）拦截，全部改动保留在工作区待用户处置后一并提交。

## 交付内容

**K-01 后端知识树与教学计划**：`course_knowledge_nodes`（sort_key 唯一、parent 自引用、position 左/右）与 `teaching_plan_items`（manual/report 来源、report_id 软引用）两表，迁移 `k01_knowledge_tree` 隔离库升级/回退/再升级通过。BST 规则集中在 courses/domain（`find_insert_position` 空树成根/左小右大/相等拒绝 E-15；`inorder_ids` 中序升序；`ensure_node_is_leaf` 仅叶删除 E-16），批量插入逐个并入已定位节点保持 BST 性质。接口：树读取（登录可读，师生可见 Q-09④）、批量确认写入（AI 建议与手动共用唯一写入口 E-17）、删叶子、教学计划 CRUD；越权 403（E-14）。

**K-02 后端周报与内部接口**：`teacher_weekly_reports` 表（(course_id, week_start) 唯一幂等 E-18，迁移 `k02_weekly_reports` 三段验证通过）。教师端查询仅课程负责教师本人（`ensure_report_owner`，管理员不旁路、非本人 404，与 G-04-A 私有口径一致）。governance 内部服务级接口：有树课程清单（E-19 无树不进清单）、课程树读取、近期问题（时间窗 + 软删/隐藏排除，只读不增浏览量）、周报保存（敏感词拦截复用 memory 策略 + 409 幂等）；用户级树读取双凭证。qa 新增跨模块公开函数 `list_recent_question_contents`（最小字段，不含作者）。

**K-03 Agent 大纲分析任务**：新任务类型 `knowledge_tree`（教师经 BFF 触发）：输入 courseId + outlineText ≤20000；必需工具 `fetchKnowledgeTree`（user 路径）；模型产出建议后程序剔除与现有树/彼此重复的建议（去空白比较），notes 确定性说明过滤情况；纯建议不写入。`validateOutput` 增加 knowledge_tree 输出契约。读取普通故障降级为无树建议（notes 明示），401/403 不降级。

**K-04 Agent 周报调度器**：`scheduler/weekly-report.ts` + server 启动接线（`WEEKLY_REPORT_ENABLED/DAY/HOUR` 可配，默认周一 08:00 本地时区）。逐课程：服务级无主运行审计（G-04-A 旧服务入口，task_type=teaching_report）→ 拉树（空树防御跳过）→ 近 7 天问题 → LLM 语义映射（60 秒限时、无自动重试）→ **程序聚合全部数字**（热力计数、未覆盖计数、命中数来自有效映射；引用不存在问题/节点的映射剔除；模型只做语义分类）→ 保存（409 = 已存在成功跳过）→ 终态审计；单课程失败记录并继续（X-07）。启动补偿：本周触发时刻已过 30 秒后补跑，幂等由后端唯一约束 + 409 兜底。audit-client 支持服务级前缀（无主运行 user_id nullable）。系统运行不经 PlanList（无用户 HTTP 语境），但审计/超时口径沿用 G-05。

**K-05 前端**：教师端 `teacher/courses/[id]/knowledge` 三区块工作台（树形+中序展示、粘贴大纲→AI 建议→勾选确认写入、手动新增、删叶子、教学计划手动/周报来源与状态切换、周报差距"加入教学计划/拓宽知识树"一键操作）；学生端课程详情侧栏只读知识树区块（无树/失败静默隐藏）；教师课程管理页头卡加入口。API 走既有 BFF 两条通道；文案简体中文。

## 验证

| 服务 | 命令 | 结果 |
| --- | --- | --- |
| 后端（K-01/K-02 专项 + 回归） | uv run pytest tests/test_knowledge_tree.py tests/test_weekly_report.py tests/test_governance_internal.py tests/test_courses.py -q | 87 passed |
| 后端全量 | uv run pytest -q | 453 passed + 20 skipped（439 + 新增 14） |
| 后端 | ruff / lint-imports / 迁移三段（k01、k02 独立验证） | 零 error / 5 契约 KEPT / 通过 |
| Agent | vitest run / tsc / eslint | 20 文件 208 passed（199 + 调度器 9）/ 通过 / 零 error |
| 前端 | npm test / npm run lint | 68 文件 432 passed（426 + 新增 6）/ 零 error |

新增测试要点：后端 BST 纯规则（插入定位/中序/叶删/名称与计划字段校验）+ 接口边界（乱序建树结构断言、同批/跨批重复 400、非负责教师与学生 403、未登录 401、周报同周 409、敏感词 400、周区倒置 400、教师私有 404 不旁路、清单仅含有树课程、近期问题时间窗与软删/隐藏排除、用户级双凭证）；Agent（建议过滤与 notes、必需工具、读取降级与撤权不降级、程序聚合剔除伪造引用、409 跳过、单课程失败隔离、无树跳过、模型未配置整轮跳过、nextOccurrence 纯函数）；前端（三区块渲染、建议勾选仅写入所选、周报一键带 report_id、拓宽写入、手动新增、失败提示）。

## 限制与遗留

- 既有迁移测试 `test_agent_run_migration.py` 原以 `upgrade(head)` 后断言版本等于 g04_run_events，被 k01/k02 后续迁移打破（首轮全量 1 failed）；按 G-04-A"固定目标 revision"先例将两处 upgrade 改为固定 `g04_run_events` 后全量绿（453 passed + 20 skipped）。
- 真实模型联调未执行（全部替身）：大纲分析质量、周报映射准确率、教学术语与敏感词策略（"密码"等词在密码学课程的误伤风险，由 K-04 提示词规避 + 拦截拒绝兜底）需真实模型验证。
- 调度为单实例进程内定时器：多实例部署会重复触发（409 幂等兜底不产生重复周报，但会重复请求）；随 T-18 部署批次收敛。
- 周报 content 为模型 summary + 程序统计行，未做 Markdown 渲染差异（前端以纯文本展示）。
- K-06 收口时提交被 Mimosa 拦截（既有测试文件 fixture 密码，与本轮改动无关），全部改动在工作区待用户处置。
