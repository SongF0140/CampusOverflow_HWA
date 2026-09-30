# qa 路由层：入参出参校验、权限依赖注入、调 service、返回统一响应
# 分层基线 D-2/D-9：本层不 import models、不触碰 ORM；当前用户一律 UserPrincipal。
# 评论/标签接口随 T-06~T-07 落地。
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.core.permissions import (
    get_current_user,
    require_graduate_assistant,
    require_roles,
)
from app.core.response import ok
from app.db.session import get_db
from app.modules.qa import domain, service
from app.modules.qa.schemas import (
    AnswerCreateRequest,
    AnswerUpdateRequest,
    QuestionCreateRequest,
    QuestionUpdateRequest,
    RecommendRequest,
)

qa_router = APIRouter(prefix="/api/questions", tags=["问题"])
answers_router = APIRouter(prefix="/api", tags=["回答"])


def _question_message(truncated: bool) -> str:
    """E-02 提示文案：引用 domain 常量，不在本层写规则数字。"""
    if truncated:
        return (
            f"发布成功（内容超长已截断：标题 ≤ {domain.TITLE_MAX_LEN} 字、"
            f"正文 ≤ {domain.BODY_MAX_LEN} 字）"
        )
    return "发布成功"


def _answer_message(truncated: bool) -> str:
    """回答侧 E-02 提示文案（仅正文一项上限）。"""
    if truncated:
        return f"回答成功（正文超长已截断：≤ {domain.BODY_MAX_LEN} 字）"
    return "回答成功"


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
        _question_message(truncated),
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
    return ok(question.model_dump(), _question_message(truncated))


@qa_router.delete("/{question_id}")
def delete_question(
    question_id: int,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    """软删除问题：作者或管理员；删除确认弹窗由前端保证（Q-01，二期）。"""
    service.delete_question(db, current_user.role, current_user.id, question_id)
    return ok({"deleted": True}, "已删除")


# ---------- 回答与采纳（T-05，学生端接口文档 §4） ----------


@answers_router.get("/questions/{question_id}/answers")
def list_answers(
    question_id: int,
    sort: str = Query("latest", pattern="^(latest|votes|accepted)$"),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    _current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    """回答列表：软删不可见（E-10）；accepted 排序将被采纳回答置顶；votes 暂同 latest。"""
    items, total = service.list_answers(db, question_id, sort, page, page_size)
    return ok({"items": [i.model_dump() for i in items], "total": total, "page": page})


@answers_router.post("/questions/{question_id}/answers")
def publish_answer(
    question_id: int,
    req: AnswerCreateRequest,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    """发布回答：登录用户；问题不存在或已删 404；空内容 400（E-01）。"""
    answer, truncated = service.publish_answer(db, current_user.id, question_id, req.body)
    return ok(
        {
            "id": answer.id,
            "status": "published",
            "created_at": answer.created_at.isoformat(),
        },
        _answer_message(truncated),
    )


@answers_router.patch("/answers/{answer_id}")
def update_answer(
    answer_id: int,
    req: AnswerUpdateRequest,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    """编辑回答：仅作者；非作者 403（学生端接口文档 §4）。"""
    answer, truncated = service.update_answer(db, current_user.id, answer_id, req.body)
    return ok(answer.model_dump(), _answer_message(truncated))


@answers_router.delete("/answers/{answer_id}")
def delete_answer(
    answer_id: int,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    """软删除回答：作者或管理员（E-10）；已采纳回答被删时级联撤销采纳。"""
    service.delete_answer(db, current_user.role, current_user.id, answer_id)
    return ok({"deleted": True}, "已删除")


@answers_router.post("/answers/{answer_id}/accept")
def accept_answer(
    answer_id: int,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    """采纳回答：仅提问者（E-06）；已有采纳 400（E-05）；声誉/通知随 T-08/T-10。"""
    result = service.accept_answer(db, current_user.id, answer_id)
    return ok(result, "已采纳")


@answers_router.post("/answers/{answer_id}/recommend")
def recommend_answer(
    answer_id: int,
    req: RecommendRequest,
    current_user=Depends(require_graduate_assistant),
    db: Session = Depends(get_db),
) -> dict:
    """助教推荐标记（US-20/E-13）：仅展示标记，不改问题状态与采纳权。"""
    return ok(service.recommend_answer(db, answer_id, req.recommended), "已更新")


@answers_router.post("/answers/{answer_id}/certify")
def certify_answer(
    answer_id: int,
    current_user=Depends(require_roles("teacher")),
    db: Session = Depends(get_db),
) -> dict:
    """优质内容认证置位（D9 定案）：仅回答所在课程的负责教师。"""
    return ok(service.certify_answer(db, current_user.id, answer_id, True), "已认证")


@answers_router.delete("/answers/{answer_id}/certify")
def uncertify_answer(
    answer_id: int,
    current_user=Depends(require_roles("teacher")),
    db: Session = Depends(get_db),
) -> dict:
    """优质内容认证取消（D9 定案）：仅回答所在课程的负责教师。"""
    return ok(service.certify_answer(db, current_user.id, answer_id, False), "已取消")
