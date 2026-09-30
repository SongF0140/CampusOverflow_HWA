# qa 业务层：用例编排、事务边界与授权决策
# 分层基线 D-1/D-2/D-3：规则在 domain.py，ORM 留在 repository，本层不碰 HTTP 协议。
# 签名约定 D-7：入参只收基本类型；事务约定 D-8：写用例末尾显式 db.commit()。
from sqlalchemy.orm import Session

from app.modules.courses import domain as courses_domain
from app.modules.courses import service as courses_service
from app.modules.identity import service as identity_service
from app.modules.qa import domain, repository
from app.modules.qa.schemas import (
    QuestionDetailResponse,
    QuestionListItemResponse,
    QuestionResponse,
)


def _is_truncated(title: str, body: str) -> bool:
    """E-02 提示标志：原始输入超限即提示（清洗只会缩短，不影响判断方向）。"""
    return len(title.strip()) > domain.TITLE_MAX_LEN or len(body) > domain.BODY_MAX_LEN


def publish_question(
    db: Session, user_id: int, title: str, body: str, course_id: int
) -> tuple[QuestionResponse, bool]:
    """发布问题：非空校验（E-01）→ 清洗截断（E-02/X-03）→ 课程校验（404）→
    发布资格（403：负责教师天然可发，其余须已加入）→ 入库。
    """
    domain.ensure_not_empty(title, body)
    truncated = _is_truncated(title, body)
    course = courses_service.get_course(db, course_id)
    if course is None:
        raise courses_domain.CourseNotFoundError()
    if course.teacher_id != user_id and not courses_service.is_member(db, course_id, user_id):
        raise domain.CoursePostDeniedError()
    question = repository.create_question(
        db,
        title=domain.truncate_title(title),
        body=domain.sanitize_and_truncate_body(body),
        course_id=course_id,
        author_id=user_id,
    )
    db.commit()
    # TODO(agent): QuestionPosted 事件发布点（治理订阅，一期仅注释，见架构说明 4.A）
    return question, truncated


def list_questions(
    db: Session, page: int, page_size: int, course_id: int | None,
    sort: str, unresolved: bool, keyword: str | None,
) -> tuple[list[QuestionListItemResponse], int]:
    """问题列表：作者名跨模块批量取；投票/回答数随 T-05/T-08 回填（schema 默认 0）。"""
    questions, total = repository.list_questions(
        db, page, page_size, course_id, sort, unresolved, keyword
    )
    names = identity_service.get_usernames_by_ids(db, [q.author_id for q in questions])
    items = [
        QuestionListItemResponse(
            id=q.id,
            title=q.title,
            course_id=q.course_id,
            author=names.get(q.author_id, ""),
            status=q.status,
            view_count=q.view_count,
            created_at=q.created_at,
        )
        for q in questions
    ]
    return items, total


def get_question_detail(db: Session, question_id: int) -> QuestionDetailResponse:
    """问题详情：软删不可见（E-10）；浏览数原子 +1；回答/评论经 T-05/T-06 接口分页获取。"""
    question = repository.get_by_id(db, question_id)
    if question is None or not domain.is_visible(question.deleted_at):
        raise domain.QuestionNotFoundError()
    names = identity_service.get_usernames_by_ids(db, [question.author_id])
    repository.increment_view(db, question_id)
    db.commit()
    return QuestionDetailResponse(
        id=question.id,
        title=question.title,
        body=question.body,
        course_id=question.course_id,
        author=names.get(question.author_id, ""),
        status=question.status,
        view_count=question.view_count + 1,
        created_at=question.created_at,
        updated_at=question.updated_at,
    )


def update_question(
    db: Session, user_id: int, question_id: int, title: str | None, body: str | None
) -> tuple[QuestionResponse, bool]:
    """编辑问题：仅作者；修改的字段经非空校验（E-01）与清洗截断（E-02/X-03）。"""
    question = repository.get_by_id(db, question_id)
    if question is None or not domain.is_visible(question.deleted_at):
        raise domain.QuestionNotFoundError()
    domain.ensure_can_edit(question.author_id, user_id)
    truncated = False
    if title is not None:
        domain.ensure_not_blank(title)
        truncated = truncated or len(title.strip()) > domain.TITLE_MAX_LEN
        title = domain.truncate_title(title)
    if body is not None:
        domain.ensure_not_blank(body)
        truncated = truncated or len(body) > domain.BODY_MAX_LEN
        body = domain.sanitize_and_truncate_body(body)
    updated = repository.update_question(db, question_id, title, body)
    db.commit()
    return updated, truncated


def delete_question(db: Session, user_role: str, user_id: int, question_id: int) -> None:
    """软删除问题：作者或管理员（E-10），行保留供管理员追溯。"""
    question = repository.get_by_id(db, question_id)
    if question is None or not domain.is_visible(question.deleted_at):
        raise domain.QuestionNotFoundError()
    domain.ensure_can_delete(user_role, question.author_id, user_id)
    repository.soft_delete(db, question_id)
    db.commit()
