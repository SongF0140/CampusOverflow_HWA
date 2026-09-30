# 项目长期备注

## 架构设计哲学（2026-09-22 用户定调）
- domain/service 是基座：设计好就不改，低耦合；目标"零框架依赖"（不 import fastapi / sqlalchemy.orm）
- API 与 DB 层是易变外圈：router / schemas / models 可随需求重画，不允许倒灌进基座
- 落地清单（待实施）：每模块新增 domain.py（状态机/不变量/积分规则集中）；service 出入参只用 schemas、ORM 不上浮；service 抛领域异常，HTTPException 只在 router 层；CI 接入 lint-imports（分层契约 + domain 禁框架 import）
- 现状泄漏点：identity/service.py import fastapi 的 HTTPException、sqlalchemy Session、models.User
