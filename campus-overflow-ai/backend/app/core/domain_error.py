# 领域异常基类：纯 Python，零框架依赖（不 import fastapi/sqlalchemy/pydantic）
# 供各模块 domain.py 继承；HTTP 状态码仅作为元数据，由 core/errors.py 统一映射为响应。
from __future__ import annotations


class DomainError(Exception):
    """业务规则不满足时抛出的领域异常基类。

    service / domain 层只允许抛这类异常表达业务失败；
    禁止直接使用 fastapi.HTTPException（协议细节挡在接口层之外）。
    """

    # 默认映射的 HTTP 状态码，子类可覆盖
    http_status: int = 400

    def __init__(self, message: str | None = None) -> None:
        self.message = message or self.__class__.__doc__ or "业务规则不满足"
        super().__init__(self.message)
