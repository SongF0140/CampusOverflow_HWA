# 统一响应格式：{ code, data, message }（约定见 docs/后端架构说明.md 第 5 节）
from typing import Any

from fastapi.responses import JSONResponse


def ok(data: Any = None, message: str = "success") -> dict[str, Any]:
    """成功响应体（HTTP 200）。"""
    return {"code": 200, "data": data, "message": message}


def fail(code: int = 500, message: str = "服务器错误") -> JSONResponse:
    """失败响应体：错误码仅 200/400/401/403/404/500 六种（governance 占位例外 501）。"""
    return JSONResponse(status_code=code, content={"code": code, "data": None, "message": message})
