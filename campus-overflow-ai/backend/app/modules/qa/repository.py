# qa 数据访问：查询与写入函数，仅被本模块 service 调用（架构规则 2.3-3）
# 分层基线 D-2：本文件是模块内唯一允许 import models 的地方；出参一律 schemas。
# 事务约定 D-8：本层只 flush 不 commit，事务边界（commit）在 service 用例层。
from datetime import datetime

from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.modules.qa import domain
from app.modules.qa.models import Question
from app.modules.qa.schemas import QuestionResponse

SORT_LATEST = "latest"
SORT_HOT = "hot"


def get_by_id(db: Session, question_id: int) -> QuestionResponse | None:
    """按主键查询问题（含已软删，可见性由 domain.is_visible 在 service 判定）。"""
    question = db.get(Question, question_id)
    return QuestionResponse.model_validate(question) if question else None


def create_question(
    db: Session, title: str, body: str, course_id: int, author_id: int
) -> QuestionResponse:
    """新建问题，默认 published 状态（标题/正文已由 domain 清洗截断）。"""
    question = Question(title=title, body=body, course_id=course_id, author_id=author_id)
    db.add(question)
    db.flush()
    return QuestionResponse.model_validate(question)


def update_question(
    db: Session, question_id: int, title: str | None, body: str | None
) -> QuestionResponse:
    """编辑问题字段（None 表示不修改）。"""
    question = db.get(Question, question_id)
    if question is None:
        raise domain.QuestionNotFoundError()
    if title is not None:
        question.title = title
    if body is not None:
        question.body = body
    db.flush()
    return QuestionResponse.model_validate(question)


def soft_delete(db: Session, question_id: int) -> None:
    """软删除：仅标记 deleted_at，行保留供管理员追溯（E-10）。"""
    question = db.get(Question, question_id)
    if question is None:
        raise domain.QuestionNotFoundError()
    question.deleted_at = datetime.now()
    db.flush()


def increment_view(db: Session, question_id: int) -> None:
    """浏览数原子自增（详情接口每次 +1）。"""
    db.query(Question).filter(Question.id == question_id).update(
        {Question.view_count: Question.view_count + 1}
    )
    db.flush()


def list_questions(
    db: Session, page: int, page_size: int, course_id: int | None,
    sort: str, unresolved: bool, keyword: str | None,
) -> tuple[list[QuestionResponse], int]:
    """分页列问题：软删不可见（E-10）；支持课程/未解决/关键词筛选与最新/热度排序。

    hot 暂按浏览数排序（投票分随 T-08 回填后改为 vote_score）。
    """
    query = db.query(Question).filter(Question.deleted_at.is_(None))
    if course_id is not None:
        query = query.filter(Question.course_id == course_id)
    if unresolved:
        query = query.filter(Question.status == domain.STATUS_PUBLISHED)
    if keyword:
        like = f"%{keyword}%"
        query = query.filter(or_(Question.title.like(like), Question.body.like(like)))
    total = query.count()
    if sort == SORT_HOT:
        query = query.order_by(Question.view_count.desc(), Question.created_at.desc())
    else:
        query = query.order_by(Question.created_at.desc())
    offset = (page - 1) * page_size
    questions = query.offset(offset).limit(page_size).all()
    return [QuestionResponse.model_validate(q) for q in questions], total
