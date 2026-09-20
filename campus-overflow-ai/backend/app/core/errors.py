# 全局异常处理：所有错误统一为 { code, data, message }，错误码归一到六种
# （422 校验错误按管理员端接口文档 1.5 节结论归一为 400）
from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from app.core.logging import action_logger


class BizException(HTTPException):
    """业务异常：业务规则不满足时抛出，等价 HTTPException 但语义更明确。"""


def _error_response(status_code: int, message: str) -> JSONResponse:
    return JSONResponse(
        status_code=status_code,
        content={"code": status_code, "data": None, "message": message},
    )


def register_exception_handlers(app: FastAPI) -> None:
    """在 main.py 装配时注册全局异常处理器。"""

    @app.exception_handler(BizException)
    async def biz_exception_handler(_request: Request, exc: BizException) -> JSONResponse:
        return _error_response(exc.status_code, str(exc.detail))

    @app.exception_handler(HTTPException)
    async def http_exception_handler(_request: Request, exc: HTTPException) -> JSONResponse:
        return _error_response(exc.status_code, str(exc.detail))

    @app.exception_handler(RequestValidationError)
    async def validation_exception_handler(
        _request: Request, exc: RequestValidationError
    ) -> JSONResponse:
        # 入参校验失败：422 归一为 400，取第一条错误生成中文提示
        first = exc.errors()[0] if exc.errors() else {}
        loc = ".".join(str(part) for part in first.get("loc", []) if part != "body")
        message = f"请求参数不合法：{loc or '请求体'} {first.get('msg', '')}".strip()
        action_logger.warning("参数校验失败: %s", message)
        return _error_response(400, message)

    @app.exception_handler(Exception)
    async def unhandled_exception_handler(_request: Request, exc: Exception) -> JSONResponse:
        action_logger.exception("未处理异常: %s", exc)
        return _error_response(500, "服务器内部错误，请稍后重试")
