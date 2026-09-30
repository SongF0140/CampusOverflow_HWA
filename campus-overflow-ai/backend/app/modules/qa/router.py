# qa 路由层：入参出参校验、权限依赖注入、调 service、返回统一响应
# 分层基线 D-2/D-9：本层不 import models、不触碰 ORM；当前用户一律 UserPrincipal。
# 回答/评论/采纳/标签接口随 T-05~T-07 落地。
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.core.permissions import get_current_user
from app.core.response import ok
from app.db.session import get_db
from app.modules.qa import domain, service
from app.modules.qa.schemas import QuestionCreateRequest, QuestionUpdateRequest

qa_router = APIRouter(prefix="/api/questions", tags=["问题"])


def _publish_message(truncated: bool) -> str:
    """E-02 提示文案：引用 domain 常量，不在本层写规则数字。"""
    if truncated:
        return (
            f"发布成功（内容超长已截断：标题 ≤ {domain.TITLE_MAX_LEN} 字、"
            f"正文 ≤ {domain.BODY_MAX_LEN} 字）"
        )
    return "发布成功"


@qa_router.post("")
def publish_question(
    req: QuestionCreateRequest,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    """发布问题：登录用户；未加入课程 403，课程不存在 404（学生端接口文档 §3）。"""
    question, truncated = service.publish_question(
        db, current_user.id, req.title, req.body, req.course_id
    )
    return ok(
        {
            "id": question.id,
            "title": question.title,
            "status": question.status,
            "created_at": question.created_at.isoformat(),
        },
        _publish_message(truncated),
    )


@qa_router.get("")
def list_questions(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    course_id: int | None = Query(None),
    sort: str = Query("latest", pattern="^(latest|hot)$"),
    unresolved: bool = Query(False),
    keyword: str | None = Query(None),
    _current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    """问题列表：软删不可见（E-10）；sort=hot 暂按浏览数（T-08 后改投票分）。"""
    items, total = service.list_questions(
        db, page, page_size, course_id, sort, unresolved, keyword
    )
    data = {
        "items": [i.model_dump() for i in items],
        "total": total,
        "page": page,
        "page_size": page_size,
    }
    return ok(data)


@qa_router.get("/{question_id}")
def get_question(
    question_id: int,
    _current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    """问题详情：浏览数 +1；不存在或已软删 404（E-10）。"""
    question = service.get_question_detail(db, question_id)
    return ok(question.model_dump())


@qa_router.patch("/{question_id}")
def update_question(
    question_id: int,
    req: QuestionUpdateRequest,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    """编辑问题：仅作者；非作者 403（学生端接口文档 §3）。"""
    question, truncated = service.update_question(
        db, current_user.id, question_id, req.title, req.body
    )
    return ok(question.model_dump(), _publish_message(truncated))


@qa_router.delete("/{question_id}")
def delete_question(
    question_id: int,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    """软删除问题：作者或管理员；删除确认弹窗由前端保证（Q-01，二期）。"""
    service.delete_question(db, current_user.role, current_user.id, question_id)
    return ok({"deleted": True}, "已删除")
