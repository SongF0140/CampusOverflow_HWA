# 统一响应格式：{ code, data, message }（见 .trae/rules/project-context.md API 约定）
from typing import Any

from fastapi.responses import JSONResponse


def ok(data: Any = None, message: str = "success") -> dict[str, Any]:
    return {"code": 200, "data": data, "message": message}


def fail(code: int = 500, message: str = "服务器错误") -> JSONResponse:
    return JSONResponse(status_code=code, content={"code": code, "data": None, "message": message})
