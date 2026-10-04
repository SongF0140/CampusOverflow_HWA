# interaction 路由层：投票、声誉与榜单接口（学生端接口文档 §6；公开声誉 §2）
# 分层基线 D-9：当前用户一律 UserPrincipal，本层不 import models。
from datetime import datetime

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.core.permissions import get_current_user
from app.core.response import ok
from app.db.session import get_db
from app.modules.interaction import service
from app.modules.interaction.schemas import VoteCreateRequest
from app.modules.qa import domain as qa_domain
from app.modules.qa import service as qa_service
from app.modules.qa.schemas import AnswerCreateRequest, CommentCreateRequest

votes_router = APIRouter(prefix="/api/votes", tags=["投票"])
reputation_router = APIRouter(prefix="/api/reputation", tags=["声誉"])
notifications_router = APIRouter(prefix="/api/notifications", tags=["通知"])
# 公开声誉路径属 /api/users/** 命名空间，但挂 interaction（避免 identity→interaction 反向依赖）
public_reputation_router = APIRouter()


@public_reputation_router.get("/api/questions", tags=["问题"])
def list_questions(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    course_id: int | None = Query(None),
    tag_id: int | None = Query(None),
    sort: str = Query("latest", pattern="^(latest|hot)$"),
    unresolved: bool = Query(False),
    keyword: str | None = Query(None),
    created_from: datetime | None = Query(None), created_before: datetime | None = Query(None),
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    items, total = service.list_questions(
        db, page, page_size, course_id, sort, unresolved, keyword, current_user.id, tag_id,
        created_from, created_before,
    )
    return ok({
        "items": [i.model_dump() for i in items],
        "total": total, "page": page, "page_size": page_size,
    })


@public_reputation_router.get("/api/questions/{question_id}", tags=["问题"])
def get_question(
    question_id: int,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    question = service.get_question_detail(db, question_id, current_user.id)
    return ok(question.model_dump())


@public_reputation_router.get("/api/questions/{question_id}/answers", tags=["回答"])
def list_answers(
    question_id: int,
    sort: str = Query("latest", pattern="^(latest|votes|accepted)$"),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    items, total = service.list_answers(
        db, question_id, sort, page, page_size, current_user.id
    )
    return ok({"items": [i.model_dump() for i in items], "total": total, "page": page})


@public_reputation_router.post("/api/answers/{answer_id}/accept", tags=["回答"])
def accept_answer(
    answer_id: int,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    result = service.accept_answer(db, current_user.id, answer_id)
    return ok(result, "已采纳")


# ---------- 回答/评论发表编排端点（T-10：内容写入与通知同事务，接口文档 §8 编排推荐） ----------


def _answer_message(truncated: bool) -> str:
    """回答侧 E-02 提示文案（仅正文一项上限，引用 qa domain 常量）。"""
    if truncated:
        return f"回答成功（正文超长已截断：≤ {qa_domain.BODY_MAX_LEN} 字）"
    return "回答成功"


def _comment_message(truncated: bool) -> str:
    """评论侧 E-02 提示文案（上限引用 domain.COMMENT_MAX_LEN）。"""
    if truncated:
        return f"评论成功（内容超长已截断：≤ {qa_domain.COMMENT_MAX_LEN} 字）"
    return "评论成功"


@public_reputation_router.post("/api/questions/{question_id}/answers", tags=["回答"])
def publish_answer(
    question_id: int,
    req: AnswerCreateRequest,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    """发布回答：登录用户；问题不存在或已删 404；空内容 400（E-01）；同事务通知提问者。"""
    answer, truncated = service.publish_answer(db, current_user.id, question_id, req.body)
    return ok(
        {
            "id": answer.id,
            "status": "published",
            "created_at": answer.created_at.isoformat(),
        },
        _answer_message(truncated),
    )


@public_reputation_router.post("/api/questions/{question_id}/comments", tags=["评论"])
def publish_question_comment(
    question_id: int,
    req: CommentCreateRequest,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    """评论问题：空评论 400（E-01）；问题不存在或已删 404；同事务通知目标作者。"""
    comment, truncated = service.publish_comment(
        db, current_user.id, qa_service.COMMENT_TARGET_QUESTION, question_id,
        req.body, req.parent_id,
    )
    return ok(
        {
            "id": comment.id,
            "parent_id": comment.parent_id,
            "created_at": comment.created_at.isoformat(),
        },
        _comment_message(truncated),
    )


@public_reputation_router.post("/api/answers/{answer_id}/comments", tags=["评论"])
def publish_answer_comment(
    answer_id: int,
    req: CommentCreateRequest,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    """评论回答：空评论 400（E-01）；回答不存在或已删 404；同事务通知目标作者。"""
    comment, truncated = service.publish_comment(
        db, current_user.id, qa_service.COMMENT_TARGET_ANSWER, answer_id,
        req.body, req.parent_id,
    )
    return ok(
        {
            "id": comment.id,
            "parent_id": comment.parent_id,
            "created_at": comment.created_at.isoformat(),
        },
        _comment_message(truncated),
    )


@votes_router.post("")
def create_vote(
    req: VoteCreateRequest,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    """投票（US-07/E-04）：toggle 语义（重复同方向=取消）；封禁用户已被依赖统一拦截（E-07）。"""
    result = service.vote(
        db, current_user.id, req.target_type, req.target_id, req.value
    )
    return ok(result.model_dump(), "投票成功")


@reputation_router.get("/me")
def my_reputation(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    """我的积分与流水（US-08/E-11：流水仅本人可见，未登录 401）。"""
    result = service.my_reputation(db, current_user.id, page, page_size)
    return ok(result.model_dump())


@reputation_router.get("/rank")
def rank(
    period: str = Query("all", pattern="^(week|month|all)$"),
    course_id: int | None = Query(None),
    _current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    """积分榜单（US-08）：week/month/all × 课程维度；内存聚合实现（Q-04，无 Redis）。"""
    result = service.rank(db, period, course_id)
    return ok(result.model_dump())


@public_reputation_router.get("/api/users/{user_id}/reputation", tags=["声誉"])
def public_reputation(
    user_id: int,
    _current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    """用户公开声誉（US-08）：总分与发帖/回答数，不含流水（E-11）。"""
    result = service.public_reputation(db, user_id)
    return ok(result.model_dump())


@notifications_router.get("")
def list_notifications(
    unread_only: bool = Query(False),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    """我的通知（US-15/E-11）：仅本人；unread_count 恒为本人全部未读数（接口文档 §8）。"""
    result = service.list_notifications(db, current_user.id, unread_only, page, page_size)
    return ok(result.model_dump())


@notifications_router.post("/{notification_id}/read")
def read_notification(
    notification_id: int,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    """单条已读（幂等）：不存在或非本人 404，不泄露归属（接口文档 §8）。"""
    unread_count = service.read_notification(db, current_user.id, notification_id)
    return ok({"unread_count": unread_count}, "已读")


@notifications_router.post("/read-all")
def read_all_notifications(
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    """全部已读（幂等）：重复或原无未读均成功（接口文档 §8）。"""
    unread_count = service.read_all_notifications(db, current_user.id)
    return ok({"unread_count": unread_count}, "已读")
