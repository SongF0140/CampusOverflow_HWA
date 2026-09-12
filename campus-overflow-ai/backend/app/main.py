# 应用入口：路由按模块逐步挂载（见 specs/tasks.md）
from fastapi import FastAPI

from app.core.config import settings
from app.modules.tasks.router import router as tasks_router
from app.shared.response import ok

app = FastAPI(title=settings.app_name, version="0.1.0", debug=settings.debug)

# 业务路由注册
app.include_router(tasks_router)


@app.get("/health")
@app.get("/api/health")
def health() -> dict:
    """健康检查：/health 供运维探针，/api/health 供前端 BFF 代理。"""
    return ok({"status": "up", "service": "backend"})
