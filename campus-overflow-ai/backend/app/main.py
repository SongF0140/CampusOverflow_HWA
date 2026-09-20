# 应用入口（装配角色）：CORS、全局异常处理、按模块逐步挂载路由（见 specs/tasks.md）
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import settings
from app.core.errors import register_exception_handlers
from app.core.response import ok
from app.modules.governance.router import router as governance_router
from app.modules.identity.router import auth_router, users_router

app = FastAPI(title=settings.app_name, version="0.2.0", debug=settings.debug)

# CORS 白名单（偏离参考设计 #7：不全开，来源见 BACKEND_CORS_ORIGINS）
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in settings.cors_origins.split(",") if o.strip()],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 全局异常处理：统一 { code, data, message }，422 归一 400
register_exception_handlers(app)

# 业务路由注册（已实现：identity 域；courses/qa/interaction/discovery 随 T-03~T-09 逐步挂载）
app.include_router(auth_router)
app.include_router(users_router)
app.include_router(governance_router)

# TODO(agent): /internal/agent/* 白名单接口前缀占位（T-12，第二阶段启用）
# 服务间鉴权用 settings.agent_service_token，Agent 不得直连数据库（AGENTS.md 硬性约束 1）

# TODO(agent): 事件钩子占位——qa/interaction service 中的发布点：
#   QuestionPosted / AnswerPosted / ContentFlagged（治理订阅，见 docs/后端架构说明.md 4.C）


@app.get("/health")
@app.get("/api/health")
def health() -> dict:
    """健康检查：/health 供运维探针，/api/health 供前端 BFF 代理。"""
    return ok({"status": "up", "service": "backend"})
