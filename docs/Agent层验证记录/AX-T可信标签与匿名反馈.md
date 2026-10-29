# AX-T 可信标签与匿名学习反馈

日期：2026-10-28。用户连续实施授权下完成后端契约与周报接线，聊天入口由主代理集成。

## 设计依据与决策

spec AX-R03/AX-R04、Memory M-D06、用户“tag按教材和老师创建的为准，不要瞎生成”及匿名问题概括/tag/知识点/次数进入教师周报的决定。

- 可信来源显式由课程负责教师或管理员维护；旧 custom/tech 标签均不自动可信。教材来源必须提供 source_ref（教材或书签依据）。
- 学习事件不接受原文、自由摘要、user_id/session/history/memory，后端确定性以受控tag名称生成“关于‘X’的学习疑问”。这是一种最小概括，无法从任意私人问题抽取详细共性内容。
- 学生必须已入课，通过服务凭证+当前用户凭证提交；知识点/标签/公开题目均校验课程，原题需当前可见。
- UUID去重，相同ID参数替换409；事件表不存账号或会话。每个事件每个标签只计一次，不解释成学生人数。
- 读取近7天匿名聚合，失效标签不输出、删除知识点不输出、已隐藏原题不链接。后台服务可读匿名聚合，教师只读本人课程。

## 接口与存储

- PUT /api/learning/courses/{course_id}/trusted-tags/{tag_id}：{source:teacher|textbook,active,source_ref?}。
- GET /internal/agent/user/courses/{course_id}/trusted-tags：课程有效可信标签列表，含id/tag_id/course_id/name/source/active。
- GET /internal/agent/knowledge-catalog/tags：服务级只读 {items:[{id,course_id,source,active}]}，不返回维护人或私人信息。
- POST /internal/agent/user/learning-events：{event_id,course_id,tag_ids,knowledge_node_ids?,question_id?}，严格拒绝额外字段。
- GET /internal/agent/learning-feedback/{course_id}?days=7：服务级调度读取。
- GET /api/learning/courses/{course_id}/feedback?days=7：仅本人负责教师读取。
- 聚合响应为 {course_id,items:[{tag_id,tag_name,summary,count,knowledge_node_ids,question_links}]}。
- 新增 course_tag_sources / anonymous_learning_events 两表，ax_t_learning 接 ap03_waits；无私人原文与直接用户/会话关联字段。
- Agent 周报通过可选 fetchLearningFeedback 读取并追加正文，不把事件传给模型；模型不决定次数。公开链接只允许 /questions/{正整数}，课程不匹配拒绝。正文最多展示20主题、每主题5条公开链接，次数仍为完整聚合数。

## 验证记录

- 后端最初10项全部失败，缺路由；实现后通过，并补服务词表、课程交叉、时间窗口和匿名字段测试。
- 后端学习专项14项、认证专项14项及两项隔离迁移合跑：30 passed。迁移均在仓库专用临时SQLite完成升级/降级/再次升级，无业务库操作。
- 周报接线反例先1 failed/10 passed（未调用反馈方法）；实现后周报/高频标签/匿名反馈渲染3文件19 passed。
- 覆盖旧custom标签不被信任、维护越权、服务凭证缺失、未入课、额外私密字段拒绝、事件重复与替换、失效标签、隐藏/跨课原题、外部伪造链接和跨课反馈拒绝。
- 后端相关ruff、5条分层契约通过；Agent相关eslint通过。Agent全服务tsc曾因主代理尚未加入fetchLearningFeedback接口暂失败，主代理接线后已重新运行全服务tsc通过。

## 限制

- 概括来自受控标签，无法代替语义分析私人问题；这是为保证隐私做的最小实现。
- 当前按近7天完整事件集合在服务层聚合，未做大规模负载验证；真正规模化可改数据库分组或物化聚合。
- 独立事件UUID幂等不等于防刷机制，没有声称次数就是独立学生人数。
