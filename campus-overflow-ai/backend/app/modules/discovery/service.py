from datetime import datetime

from sqlalchemy.orm import Session

from app.core.domain_error import DomainError
from app.modules.courses import domain as courses_domain
from app.modules.courses import service as courses_service
from app.modules.courses.schemas import CourseDetailResponse, CourseListItemResponse
from app.modules.discovery.schemas import (
    CourseActiveUser,
    CourseAggregates,
)
from app.modules.identity import service as identity_service
from app.modules.interaction import service as interaction_service
from app.modules.qa import service as qa_service
from app.modules.qa.schemas import QuestionListItemResponse


def search(
    db: Session, viewer_id: int, q: str, page: int, page_size: int,
    course_id: int | None, tag_id: int | None, sort: str, unresolved: bool,
    created_from: datetime | None, created_before: datetime | None,
) -> tuple[list[QuestionListItemResponse], int]:
    q = q.strip()
    if not 1 <= len(q) <= 100:
        raise DomainError("搜索关键词须为 1 至 100 字")
    return interaction_service.list_questions(
        db, page, page_size, course_id, sort, unresolved, q, viewer_id, tag_id,
        created_from, created_before
    )


def related(db: Session, question_id: int, viewer_id: int) -> list[QuestionListItemResponse]:
    items = qa_service.list_related_questions(db, question_id)
    votes = interaction_service.get_my_vote_map(db, viewer_id, "question", [i.id for i in items])
    for item in items:
        item.my_vote = votes.get(item.id, 0)
    return items


def list_courses(
    db: Session, page: int, page_size: int, keyword: str | None, semester: str | None,
) -> tuple[list[CourseListItemResponse], int]:
    items, total = courses_service.list_courses(db, page, page_size, keyword, semester)
    counts = qa_service.count_questions_by_course_ids(db, [i.id for i in items])
    for item in items:
        item.question_count = counts.get(item.id, 0)
    return items, total


def course_questions(
    db: Session, course_id: int, viewer_id: int, page: int, page_size: int,
    tag_id: int | None, sort: str, unresolved: bool, keyword: str | None,
    created_from: datetime | None, created_before: datetime | None,
) -> tuple[list[QuestionListItemResponse], int]:
    if courses_service.get_course(db, course_id) is None:
        raise courses_domain.CourseNotFoundError()
    return interaction_service.list_questions(
        db, page, page_size, course_id, sort, unresolved, keyword, viewer_id, tag_id,
        created_from, created_before
    )


def course_detail(db: Session, course_id: int, viewer_id: int) -> CourseDetailResponse:
    detail = courses_service.get_detail(db, course_id, viewer_id)
    hot, _ = interaction_service.list_questions(
        db, 1, 10, course_id, "hot", False, None, viewer_id
    )
    active = []
    last_count = last_user_id = None
    while len(active) < 10:
        batch = qa_service.list_course_activity_batch(db, course_id, last_count, last_user_id)
        if not batch:
            break
        names = identity_service.get_usernames_by_ids(db, [uid for uid, _ in batch])
        for uid, count in batch:
            if uid in names:
                active.append(CourseActiveUser(
                    user_id=uid, username=names[uid], activity_count=count
                ))
                if len(active) == 10:
                    break
        last_user_id, last_count = batch[-1]
        if len(batch) < 100:
            break
    aggregates = CourseAggregates(
        hot_questions=hot, frequent_questions=hot,
        tags=qa_service.list_course_tags(db, course_id), active_users=active,
    )
    detail.aggregates = detail.aggregates.model_validate(aggregates.model_dump())
    return detail
