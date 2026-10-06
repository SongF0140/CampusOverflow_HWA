# Agent 内部白名单路由（T-12，C-05）：/internal/agent/* 服务间接口
# 鉴权：X-Service-Token 对比 settings.agent_service_token（不走用户 JWT）；
# 追踪：X-Trace-Id 透传，缺省服务端生成并回写响应头；白名单之外不提供任何能力。
# 分层基线：本层只收参调 service_internal，不 import models。
import secrets
import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request, Response, status
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.logging import action_logger
from app.core.response import ok
from app.db.session import get_db
from app.modules.governance import service_internal
from app.modules.governance.schemas import (
    ApprovalCreateRequest,
    MemoryWriteRequest,
    RunCreateRequest,
    RunUpdateRequest,
    ToolCallCreateRequest,
)

router = APIRouter(prefix="/internal/agent", tags=["Agent 内部接口"])

DbSession = Annotated[Session, Depends(get_db)]


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


# 服务间鉴权依赖别名：所有 /internal/agent/* 接口必须经过（C-05 白名单入口）
ServiceAuth = Annotated[str, Depends(require_service_token)]


@router.get("/memory")
def list_memory(
    db: DbSession,
    trace_id: ServiceAuth,
    user_id: Annotated[int, Query(description="记忆归属用户")],
    task_type: Annotated[str | None, Query(max_length=50)] = None,
    memory_type: Annotated[str | None, Query(max_length=20)] = None,
    course_id: Annotated[int | None, Query()] = None,
) -> dict:
    """读取相关记忆（plan §5）：按用户 / 任务类型 / 课程过滤（US-17 / C-07）。"""
    items = service_internal.list_memories(db, user_id, task_type, memory_type, course_id)
    return ok({"items": [i.model_dump() for i in items], "total": len(items)})


@router.post("/memory")
def write_memory(
    req: MemoryWriteRequest,
    db: DbSession,
    trace_id: ServiceAuth,
) -> dict:
    """写入记忆：敏感信息过滤与审计在 service 层（US-17 / C-07 / X-06）。"""
    item = service_internal.write_memory(
        db, req.user_id, req.memory_type, req.content, req.course_id, req.source_run_id, trace_id
    )
    return ok(item.model_dump(), "记忆写入成功")


@router.post("/approvals")
def create_approval(req: ApprovalCreateRequest, db: DbSession, trace_id: ServiceAuth) -> dict:
    """高风险动作生成待确认工单（C-06）：只落 moderation_cases，绝不执行处置。"""
    case = service_internal.create_approval(
        db, req.action_type, req.risk_level, req.payload_snapshot,
        req.trace_id or trace_id, req.agent_run_id,
        req.target_type, req.target_id, req.reason,
    )
    return ok(case.model_dump(), "审批工单已创建，等待人工处理")


@router.get("/courses/search")
def search_courses(
    db: DbSession,
    trace_id: ServiceAuth,
    keyword: Annotated[str, Query(min_length=1, max_length=50)],
    limit: Annotated[int, Query(ge=1, le=50)] = 10,
) -> dict:
    """站内课程检索（plan §5 / US-10 / US-12）：只读复用 courses 查询。"""
    items, total = service_internal.search_courses(db, keyword, limit)
    return ok({"items": [i.model_dump() for i in items], "total": total})


@router.get("/questions/search")
def search_questions(
    db: DbSession,
    trace_id: ServiceAuth,
    keyword: Annotated[str, Query(min_length=1, max_length=100)],
    course_id: Annotated[int | None, Query()] = None,
    tags: Annotated[str | None, Query(max_length=200)] = None,
    limit: Annotated[int, Query(ge=1, le=50)] = 10,
) -> dict:
    """相似问题候选检索（plan §5 / US-09 / US-12）：tags 为逗号分隔标签名。"""
    items, total = service_internal.search_questions(db, keyword, course_id, tags, limit)
    return ok({"items": [i.model_dump() for i in items], "total": total})


@router.get("/tags")
def list_tags(
    db: DbSession,
    trace_id: ServiceAuth,
    limit: Annotated[int, Query(ge=1, le=500)] = 100,
) -> dict:
    """站内标签词表（plan §5 / US-11 / E-09）：标签推荐候选集，只读。"""
    items = service_internal.list_tags(db, limit)
    return ok({"items": [i.model_dump() for i in items], "total": len(items)})


@router.post("/runs")
def create_run(req: RunCreateRequest, db: DbSession, trace_id: ServiceAuth) -> dict:
    """创建 Agent 运行记录（plan §5 / US-18）：agent_run_id 缺省后端兜底生成。"""
    run = service_internal.create_run(
        db, req.task_type, req.trace_id or trace_id, req.input_summary, req.agent_run_id
    )
    return ok(run.model_dump(), "运行记录已创建")


@router.patch("/runs/{agent_run_id}")
def update_run(
    agent_run_id: str,
    req: RunUpdateRequest,
    db: DbSession,
    trace_id: ServiceAuth,
) -> dict:
    """更新运行结果（plan §5 / US-18）：状态机校验，终态不可变更。"""
    run = service_internal.update_run(
        db, agent_run_id, req.status, req.output_summary, req.error_summary
    )
    return ok(run.model_dump(), "运行记录已更新")


@router.post("/tool-calls")
def record_tool_call(req: ToolCallCreateRequest, db: DbSession, trace_id: ServiceAuth) -> dict:
    """记录工具调用摘要（plan §5 / US-18）：不落原始密钥和隐私原文。"""
    log = service_internal.record_tool_call(
        db, req.agent_run_id, req.tool_name, req.args_summary,
        req.result_summary, req.status, req.duration_ms, trace_id,
    )
    return ok(log.model_dump(), "工具调用已记录")
