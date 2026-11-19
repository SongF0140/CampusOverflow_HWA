# 服务间鉴权：/internal/agent/* 统一入口（C-05 白名单），token + trace id 透传。
import secrets
import uuid
from typing import Annotated

from fastapi import Depends, Header, HTTPException, Request, Response, status

from app.core.config import settings
from app.core.logging import action_logger


def require_service_token(
    request: Request,
    response: Response,
    x_service_token: Annotated[str | None, Header(alias="X-Service-Token")] = None,
    x_trace_id: Annotated[str | None, Header(alias="X-Trace-Id")] = None,
) -> str:
    """服务间鉴权 + trace id 透传：token 缺失/错误 401；缺 trace id 时生成并回写响应头。"""
    if not x_service_token or not secrets.compare_digest(
        x_service_token.encode("utf-8"), settings.agent_service_token.encode("utf-8")
    ):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="服务间凭证缺失或无效"
        )
    trace_id = (x_trace_id or "").strip() or uuid.uuid4().hex
    response.headers["X-Trace-Id"] = trace_id
    action_logger.info("internal_agent_call path=%s trace_id=%s", request.url.path, trace_id)
    return trace_id


ServiceAuth = Annotated[str, Depends(require_service_token)]
