# 维护读模式（S2）：夜间构建知识快照期间只允许只读问答与浏览，业务写操作统一拒绝
from collections.abc import Awaitable, Callable
from datetime import datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse, Response

from app.core.config import settings

# 维护窗口固定按东八区判定，不额外引入时区配置；
# Windows 等缺少系统时区库的环境回退到固定 UTC+8（上海自 1991 年起无夏令时）
try:
    MAINTENANCE_TZ: ZoneInfo | timezone = ZoneInfo("Asia/Shanghai")
except ZoneInfoNotFoundError:
    MAINTENANCE_TZ = timezone(timedelta(hours=8), "Asia/Shanghai")
# 只读方法直接放行
READ_ONLY_METHODS = frozenset({"GET", "HEAD", "OPTIONS"})
# 放行路径前缀：服务间接口、认证与健康检查不受维护影响
EXEMPT_PREFIXES = ("/internal/agent/", "/api/auth/", "/health")
MAINTENANCE_MESSAGE = "系统维护中，当前仅支持浏览与问答"

NextCall = Callable[[Request], Awaitable[Response]]


def parse_hhmm(value: str) -> time | None:
    """解析 HH:MM 为 time；非法输入返回 None，由调用方按关闭处理，不抛异常。"""
    if not isinstance(value, str):
        return None
    parts = value.strip().split(":")
    if len(parts) != 2 or not all(part.isdigit() for part in parts):
        return None
    hour, minute = int(parts[0]), int(parts[1])
    if not (0 <= hour <= 23 and 0 <= minute <= 59):
        return None
    return time(hour=hour, minute=minute)


def is_read_only_window(now: datetime, start: str, end: str) -> bool:
    """判断 now 是否落在只读窗口内（左闭右开）。

    start > end 视为跨午夜窗口（如 23:00-02:00）；start == end 视为空窗口。
    任一时刻非法时按关闭处理，避免配置笔误造成全天封写。
    """
    start_time = parse_hhmm(start)
    end_time = parse_hhmm(end)
    if start_time is None or end_time is None:
        return False
    current = now.timetz().replace(tzinfo=None)
    if start_time < end_time:
        return start_time <= current < end_time
    if start_time > end_time:
        return current >= start_time or current < end_time
    return False


class ReadOnlyMaintenanceMiddleware(BaseHTTPMiddleware):
    """维护窗口内拦截业务写请求，返回统一 503 提示；不查询数据库。"""

    async def dispatch(self, request: Request, call_next: NextCall) -> Response:
        if not settings.maintenance_read_only_enabled:
            return await call_next(request)
        now = datetime.now(MAINTENANCE_TZ)
        if not is_read_only_window(
            now,
            settings.maintenance_read_only_start,
            settings.maintenance_read_only_end,
        ):
            return await call_next(request)
        if request.method in READ_ONLY_METHODS or request.url.path.startswith(EXEMPT_PREFIXES):
            return await call_next(request)
        return JSONResponse(
            status_code=503,
            content={"code": 503, "data": None, "message": MAINTENANCE_MESSAGE},
        )
