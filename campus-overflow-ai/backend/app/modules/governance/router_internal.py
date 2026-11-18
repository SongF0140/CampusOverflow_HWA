# Agent 内部白名单路由（T-12，C-05）：/internal/agent/* 服务间接口
# 鉴权：通用接口用服务 token；身份解析须同时有用户 JWT；决策接口支持管理员 JWT。
# 追踪：X-Trace-Id 透传，缺省服务端生成并回写响应头；白名单之外不提供任何能力。
# 分层基线：本层只收参调 service_internal，不 import models。
import secrets
import uuid
from typing import Annotated, Literal

from fastapi import (
    APIRouter,
    Depends,
    HTTPException,
    Path,
    Query,
    Request,
    Response,
    status,
)
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.logging import action_logger
from app.core.permissions import (
    CurrentUser,
    UserPrincipal,
    get_current_user,
    get_optional_current_user,
)
from app.core.response import ok
from app.db.session import get_db
from app.modules.governance import (
    service_approvals,
    service_external,
    service_internal,
    service_scan,
    service_waits,
)
from app.modules.governance.schemas import (
    AgentPrincipalOut,
    AgentPrincipalResponse,
    AgentRunResponse,
    ApprovalCreateRequest,
    DecisionUpdateRequest,
    GovernanceRequestCreate,
    GovernanceTargetStateResponse,
    MemoryWriteRequest,
    ModerationTargetResponse,
    PatrolCaseCreateRequest,
    PatrolNoteCreateRequest,
    ReportSaveRequest,
    RunCreateRequest,
    RunEventCreateRequest,
    RunEventResponse,
    RunUpdateRequest,
    ToolCallCreateRequest,
    ToolCallResponse,
)
from app.modules.governance.schemas_scan import (
    PatrolScanCreateRequest,
    PatrolScanProgressRequest,
)

router = APIRouter(prefix="/internal/agent", tags=["Agent 内部接口"])

DbSession = Annotated[Session, Depends(get_db)]

# 服务间鉴权依赖别名：所有 /internal/agent/* 接口必须经过（C-05 白名单入口）
# 实现放在 core，其他模块可复用，避免跨模块依赖。
from app.core.service_auth import ServiceAuth, require_service_token  # noqa: E402


def get_agent_actor(request: Request, _service: ServiceAuth, db: DbSession) -> UserPrincipal:
    key = request.headers.get("x-external-agent-key")
    if key is not None:
        principal = service_external.resolve_external_admin(db, key)
        if principal is None:
            raise HTTPException(401, "外部凭证无效或已撤销")
    else:
        auth = request.headers.get("authorization", "")
        token = auth[7:] if auth.lower().startswith("bearer ") else None
        principal = get_current_user(token, db)
    return principal


AgentActor = Annotated[UserPrincipal, Depends(get_agent_actor)]


def get_agent_admin(principal: AgentActor) -> UserPrincipal:
    if principal.role != "admin":
        raise HTTPException(403, "仅管理员可操作")
    return principal


AgentAdmin = Annotated[UserPrincipal, Depends(get_agent_admin)]


@router.get("/external/principal", response_model=AgentPrincipalResponse)
def external_principal(admin: AgentAdmin) -> dict:
    return ok(AgentPrincipalOut(user_id=admin.id, role=admin.role, status=admin.status,
                               identity_type=admin.identity_type,
                               assistant_cert_status=admin.assistant_cert_status).model_dump())


@router.get(
    "/user/governance-targets/{target_type}/{target_id}/state",
    response_model=GovernanceTargetStateResponse,
    response_model_exclude_none=True,
    summary="管理员读取治理目标当前状态（不执行处置）",
)
def get_governance_target_state(
    _service: ServiceAuth,
    _admin: AgentAdmin,
    db: DbSession,
    target_type: Literal["question", "answer", "comment", "user"],
    target_id: Annotated[int, Path(ge=1)],
    include_version: bool = False,
) -> dict:
    result = service_approvals.get_target_state(
        db, target_type, target_id, include_version=include_version,
    )
    return ok(result.model_dump())


@router.post("/user/governance-requests")
def create_governance_request(
    req: GovernanceRequestCreate,
    trace_id: ServiceAuth,
    admin: AgentAdmin,
    db: DbSession,
) -> dict:
    result = service_approvals.create_request(
        db, admin.id, str(req.request_id), req.expected_version, req.target_type,
        req.target_id, req.action, req.reason, req.duration_days, trace_id,
    )
    return ok(result.model_dump(), "申请已保存；请管理员核查后确认，不执行处置")


@router.get("/user/governance-requests/{request_id}")
def read_governance_wait(
    request_id: uuid.UUID, _service: ServiceAuth,
    admin: AgentAdmin, db: DbSession,
) -> dict:
    return ok(service_waits.read_or_resume(db, admin.id, str(request_id), "read"))


@router.post("/user/governance-requests/{request_id}/{operation}")
def resume_governance_wait(
    request_id: uuid.UUID, operation: Literal["resume", "cancel"], _service: ServiceAuth,
    admin: AgentAdmin, db: DbSession,
) -> dict:
    return ok(service_waits.read_or_resume(db, admin.id, str(request_id), operation))


@router.get(
    "/principal",
    response_model=AgentPrincipalResponse,
    summary="解析当前身份（不授予数据访问权限）",
    dependencies=[Depends(require_service_token)],
)
def resolve_principal(current_user: CurrentUser) -> AgentPrincipalResponse:
    """同时校验服务和用户凭证，返回数据库当前身份；不授予数据访问权限。"""
    # 显式映射对外字段，避免身份对象扩展后意外暴露个人资料或凭证。
    principal = AgentPrincipalOut(
        user_id=current_user.id,
        role=current_user.role,
        status=current_user.status,
        identity_type=current_user.identity_type,
        assistant_cert_status=current_user.assistant_cert_status,
    )
    return AgentPrincipalResponse(data=principal, message="身份已验证")


# ---------- 决策接口混合认证（JWT + 服务 token）----------

def get_admin_or_service_principal(
    request: Request,
    response: Response,
    principal: Annotated[UserPrincipal | None, Depends(get_optional_current_user)],
) -> tuple[UserPrincipal | None, str]:
    """决策接口混合认证：管理员 JWT 通道 或 Agent 服务 token 通道。

    - get_optional_current_user 已保证：携带 Bearer JWT 时完成用户解析，
      非法 token / 用户不存在 / 被封禁直接 401/403，不静默回退。
    - principal 为 None 表示未携带 JWT，此时校验 X-Service-Token，
      通过视为 Agent 服务调用；两种凭证都缺失 → 401。
    - trace id 两种通道统一从 X-Trace-Id 读取，缺省生成并回写响应头（C-08）。

    返回 (principal, trace_id)：JWT 通道 principal 为登录用户；服务 token 通道为 None。
    """
    trace_id = (request.headers.get("x-trace-id") or "").strip() or uuid.uuid4().hex
    response.headers["X-Trace-Id"] = trace_id

    if principal is not None:
        return principal, trace_id

    x_service_token = request.headers.get("x-service-token")
    if not x_service_token or not secrets.compare_digest(
        x_service_token.encode("utf-8"), settings.agent_service_token.encode("utf-8")
    ):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="认证失败：需要管理员登录或有效服务间凭证",
        )
    action_logger.info(
        "internal_agent_call path=%s auth=service_token trace_id=%s",
        request.url.path, trace_id,
    )
    return None, trace_id


# 决策接口认证依赖别名：返回 (UserPrincipal | None, trace_id)
DecisionAuth = Annotated[
    tuple[UserPrincipal | None, str], Depends(get_admin_or_service_principal)
]


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


@router.get(
    "/user/courses/search",
    dependencies=[Depends(require_service_token), Depends(get_current_user)],
)
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


@router.get(
    "/user/questions/search",
    dependencies=[Depends(require_service_token), Depends(get_current_user)],
)
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


@router.get(
    "/user/tags",
    dependencies=[Depends(require_service_token), Depends(get_current_user)],
)
@router.get("/tags")
def list_tags(
    db: DbSession,
    trace_id: ServiceAuth,
    limit: Annotated[int, Query(ge=1, le=500)] = 100,
) -> dict:
    """站内标签词表（plan §5 / US-11 / E-09）：标签推荐候选集，只读。"""
    items = service_internal.list_tags(db, limit)
    return ok({"items": [i.model_dump() for i in items], "total": len(items)})


@router.get(
    "/user/moderation-targets/{target_type}/{target_id}",
    dependencies=[Depends(require_service_token), Depends(get_current_user)],
    response_model=ModerationTargetResponse,
)
@router.get(
    "/moderation-targets/{target_type}/{target_id}", response_model=ModerationTargetResponse,
)
def get_moderation_target(
    db: DbSession,
    trace_id: ServiceAuth,
    target_type: Literal["question", "answer", "comment"],
    target_id: Annotated[int, Path(ge=1)],
) -> ModerationTargetResponse:
    """治理目标正文（US-13 / G-03 补充）：Agent 扫描前读原文，只读；不可见目标 404。"""
    content = service_internal.get_moderation_content(db, target_type, target_id)
    return ModerationTargetResponse(data=content)


# ---------- 知识树与周报（KN-R01/R02，K-02） ----------


@router.get("/knowledge-tree/courses")
def list_knowledge_tree_courses(db: DbSession, trace_id: ServiceAuth) -> dict:
    """有知识树的课程清单（周报调度扫描；E-19 无树课程不进清单）。"""
    items = service_internal.list_knowledge_tree_courses(db)
    return ok({"items": [i.model_dump() for i in items], "total": len(items)})


@router.get("/courses/{course_id}/knowledge-tree")
def get_course_knowledge_tree(
    db: DbSession,
    trace_id: ServiceAuth,
    course_id: Annotated[int, Path(ge=1)],
) -> dict:
    """课程知识树读取（周报分析依据；服务级只读，课程不存在 404）。"""
    tree = service_internal.get_course_knowledge_tree(db, course_id)
    return ok(tree.model_dump())


@router.get("/courses/{course_id}/questions/recent")
def list_recent_questions(
    db: DbSession,
    trace_id: ServiceAuth,
    course_id: Annotated[int, Path(ge=1)],
    days: Annotated[int, Query(ge=1, le=31)] = 7,
    limit: Annotated[int, Query(ge=1, le=200)] = 200,
) -> dict:
    """课程近期可见问题正文（周报分析依据）：只读，软删/隐藏排除。"""
    items = service_internal.list_recent_questions(db, course_id, days, limit)
    return ok({"items": [i.model_dump() for i in items], "total": len(items)})


@router.post("/reports")
def save_weekly_report(
    req: ReportSaveRequest, db: DbSession, trace_id: ServiceAuth
) -> dict:
    """保存教师周报（系统调度运行）：敏感词拦截；同课程同周唯一（E-18，冲突 409）。"""
    report = service_internal.save_weekly_report(db, req, trace_id)
    return ok(report.model_dump(), "周报已保存")


@router.get(
    "/user/courses/{course_id}/knowledge-tree",
    dependencies=[Depends(require_service_token), Depends(get_current_user)],
)
def get_user_course_knowledge_tree(
    db: DbSession,
    trace_id: ServiceAuth,
    course_id: Annotated[int, Path(ge=1)],
) -> dict:
    """用户级课程知识树读取（大纲分析任务依据）：树随课程读取权限对登录用户开放。"""
    tree = service_internal.get_course_knowledge_tree(db, course_id)
    return ok(tree.model_dump())


# ---------- 静默巡检（US-13，T-15-B） ----------


@router.get("/patrol/contents")
def list_patrol_contents(
    db: DbSession,
    trace_id: ServiceAuth,
    hours: Annotated[int, Query(ge=1, le=168)] = 1,
    limit: Annotated[int, Query(ge=1, le=200)] = 100,
) -> dict:
    """全站时间窗内新内容清单（静默巡检扫描依据）：只读，软删/隐藏排除。"""
    items = service_internal.list_patrol_contents(db, hours, limit)
    return ok({"items": [i.model_dump() for i in items], "total": len(items)})


# ---------- 管理员全量扫描（P2）：只推进进度，不产生处置 ----------


@router.post("/patrol/scans")
def create_patrol_scan(
    req: PatrolScanCreateRequest, db: DbSession, trace_id: ServiceAuth
) -> dict:
    """创建管理员全量扫描任务；同刻仅允许一个排队中/运行中任务。"""
    job = service_scan.create_scan(db, req, trace_id)
    return ok(job.model_dump(mode="json"), "扫描任务已创建")


@router.get("/patrol/scans/{job_id}")
def get_patrol_scan(
    job_id: Annotated[int, Path(ge=1)], db: DbSession, trace_id: ServiceAuth
) -> dict:
    """读取扫描任务进度与终态。"""
    return ok(service_scan.get_scan(db, job_id).model_dump(mode="json"))


@router.post("/patrol/scans/{job_id}/cancel")
def cancel_patrol_scan(
    job_id: Annotated[int, Path(ge=1)], db: DbSession, trace_id: ServiceAuth
) -> dict:
    """取消扫描任务；已终态任务保持原状，可重复调用。"""
    job = service_scan.cancel_scan(db, job_id)
    return ok(job.model_dump(mode="json"), "扫描任务已取消")


@router.patch("/patrol/scans/{job_id}/progress")
def update_patrol_scan_progress(
    job_id: Annotated[int, Path(ge=1)],
    req: PatrolScanProgressRequest,
    db: DbSession,
    trace_id: ServiceAuth,
) -> dict:
    """按批回写增量进度；取消或终态不被覆盖。"""
    job = service_scan.update_progress(db, job_id, req)
    return ok(job.model_dump(mode="json"), "扫描进度已更新")


@router.get("/patrol/scans/{job_id}/page")
def read_patrol_scan_page(
    job_id: Annotated[int, Path(ge=1)],
    db: DbSession,
    trace_id: ServiceAuth,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
) -> dict:
    """按任务游标读取下一页内容；终态任务返回空页。"""
    job, items, has_more = service_scan.read_page(db, job_id, limit)
    return ok({
        "job": job.model_dump(mode="json"),
        "items": [item.model_dump() for item in items],
        "has_more": has_more,
    })


@router.post("/patrol/cases")
def create_patrol_case(
    req: PatrolCaseCreateRequest, db: DbSession, trace_id: ServiceAuth
) -> dict:
    """巡检建单（Agent 提交评估结果）：判重幂等，pending 工单交管理员处置（C-06）。"""
    case = service_internal.create_patrol_case(
        db, req.target_type, req.target_id, req.risk_level,
        req.reason, req.snapshot, trace_id, req.agent_run_id,
    )
    if case is None:
        # 同目标已有未结案工单：幂等跳过（201 语义由 data.repeat 表达）
        return ok({"repeat": True}, "该目标已有未结案工单，跳过")
    data = case.model_dump()
    data["repeat"] = False
    return ok(data, "工单已创建，等待人工处理")


# ---------- 夜间离线整理（N-1/N-2，只读反馈 + 笔记入库） ----------


@router.get("/patrol/feedback")
def list_patrol_feedback(
    db: DbSession,
    trace_id: ServiceAuth,
    days: Annotated[int, Query(ge=1, le=90)] = 14,
    limit: Annotated[int, Query(ge=1, le=200)] = 200,
) -> dict:
    """时间窗内工单判定与最终处置（反馈闭环输入）：只读，不含快照原文。"""
    items = service_internal.list_moderation_feedback(db, days, limit)
    return ok({
        "items": [item.model_dump(mode="json") for item in items],
        "total": len(items),
        "days": days,
    })


@router.post("/patrol/notes")
def create_patrol_notes(
    req: PatrolNoteCreateRequest,
    db: DbSession,
    trace_id: ServiceAuth,
    agent_run_id: Annotated[str | None, Query(max_length=64)] = None,
) -> dict:
    """写入离线整理笔记：按 note_key 幂等，单批最多 5 条（N-1 预算）。"""
    notes, repeated = service_internal.create_patrol_notes(
        db, req.notes, trace_id, agent_run_id,
    )
    return ok({
        "items": [note.model_dump(mode="json") for note in notes],
        "total": len(notes),
        "repeated": repeated,
        "repeat": repeated == len(notes),
    }, "巡检笔记已记录")


@router.post("/patrol/notes/expire")
def expire_patrol_notes(db: DbSession, trace_id: ServiceAuth) -> dict:
    """过期降级：把超过 valid_until 的 active 笔记置为 expired。"""
    expired = service_internal.expire_patrol_notes(db, trace_id)
    return ok({"expired": expired}, "过期笔记已降级")


@router.get("/patrol/notes/injected")
def list_injected_patrol_notes(
    db: DbSession,
    trace_id: ServiceAuth,
    min_confidence: Annotated[int, Query(ge=0, le=100)] = 80,
    max_chars: Annotated[int, Query(ge=200, le=4000)] = 2000,
    limit: Annotated[int, Query(ge=1, le=50)] = 20,
) -> dict:
    """N-3 只读注入候选：active、未过期、置信度达标，按字符预算裁剪。"""
    items, truncated = service_internal.list_injectable_patrol_context(
        db, min_confidence, max_chars, limit,
    )
    return ok({
        "items": [item.model_dump(mode="json") for item in items],
        "total": len(items),
        "truncated": truncated,
        "max_chars": max_chars,
    })


@router.post("/patrol/notes/{note_id}/retract")
def retract_patrol_note(note_id: int, db: DbSession, trace_id: ServiceAuth) -> dict:
    """撤回笔记：撤回后立即不再出现在注入候选中。"""
    note = service_internal.retract_patrol_note(db, note_id, trace_id)
    return ok(note.model_dump(mode="json"), "巡检笔记已撤回")


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


@router.post("/user/runs", response_model=AgentRunResponse)
def create_user_run(
    req: RunCreateRequest, db: DbSession, trace_id: ServiceAuth, current_user: CurrentUser,
) -> AgentRunResponse:
    """创建当前用户的运行；用户与 trace 不接受请求体自报。"""
    run = service_internal.create_run(
        db, req.task_type, trace_id, req.input_summary, req.agent_run_id,
        user_id=current_user.id,
    )
    return AgentRunResponse(data=run, message="运行记录已创建")


@router.patch("/user/runs/{agent_run_id}", response_model=AgentRunResponse)
def update_user_run(
    agent_run_id: str, req: RunUpdateRequest, db: DbSession,
    _service: ServiceAuth, current_user: CurrentUser,
) -> AgentRunResponse:
    """仅更新当前用户的运行，终态不可再次迁移。"""
    run = service_internal.update_run(
        db, agent_run_id, req.status, req.output_summary, req.error_summary,
        user_id=current_user.id,
    )
    return AgentRunResponse(data=run, message="运行记录已更新")


@router.post("/user/tool-calls", response_model=ToolCallResponse)
def record_user_tool_call(
    req: ToolCallCreateRequest, db: DbSession, trace_id: ServiceAuth, current_user: CurrentUser,
) -> ToolCallResponse:
    """仅向当前用户仍运行中的记录追加工具摘要。"""
    log = service_internal.record_tool_call(
        db, req.agent_run_id, req.tool_name, req.args_summary,
        req.result_summary, req.status, req.duration_ms, trace_id, user_id=current_user.id,
    )
    return ToolCallResponse(data=log, message="工具调用已记录")


@router.post("/user/runs/{agent_run_id}/events", response_model=RunEventResponse)
def record_user_run_event(
    agent_run_id: str, req: RunEventCreateRequest, db: DbSession,
    _service: ServiceAuth, current_user: CurrentUser,
) -> RunEventResponse:
    event = service_internal.record_run_event(
        db, agent_run_id, current_user.id, req.event_type, req.plan_revision,
        [step.model_dump() for step in req.steps] if req.steps is not None else None,
        req.step_id, req.tool_name, req.duration_ms,
    )
    return RunEventResponse(data=event)


# ---------- 工单决策（T-16 双环工作流） ----------

@router.patch("/moderation-cases/{case_id}/decision")
def update_case_decision(
    case_id: int,
    req: DecisionUpdateRequest,
    db: DbSession,
    principal_trace: DecisionAuth,
    agent_run_id: Annotated[str | None, Query(description="来源运行标识")] = None,
) -> dict:
    """工单决策推进（T-16 双环工作流 / C-06）。

    认证通道：
      - 管理员 JWT（Authorization: Bearer）：可开启 manager_directed、确认执行处置；
        非管理员 JWT 一律 403。
      - Agent 服务 token（X-Service-Token）：只能 agent_proposed 提议，
        或将自己的提议以 skip 安全终止为 rejected；处置执行必须等管理员确认。
    """
    principal, trace_id = principal_trace
    if principal is not None and principal.role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="需要管理员权限"
        )

    case = service_internal.update_case_agent_decision(
        db,
        case_id,
        req.manager_feedback,
        req.decision,
        caller_is_admin=principal is not None,
        principal_id=principal.id if principal is not None else None,
        trace_id=trace_id,
        decision_source=req.decision_source,
        skip_reason=req.skip_reason,
        agent_run_id=agent_run_id,
    )
    return ok(case.model_dump(), "决策已更新")
