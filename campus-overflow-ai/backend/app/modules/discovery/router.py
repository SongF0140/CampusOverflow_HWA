from datetime import datetime

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.core.permissions import get_current_user
from app.core.response import ok
from app.db.session import get_db
from app.modules.discovery import service

router = APIRouter(prefix="/api", tags=["发现"])


@router.get("/search")
def search(
    q: str = Query(...),
    page: int = Query(1, ge=1), page_size: int = Query(20, ge=1, le=100),
    course_id: int | None = Query(None), tag_id: int | None = Query(None),
    sort: str = Query("latest", pattern="^(latest|hot)$"), unresolved: bool = Query(False),
    created_from: datetime | None = Query(None), created_before: datetime | None = Query(None),
    current_user=Depends(get_current_user), db: Session = Depends(get_db),
) -> dict:
    items, total = service.search(
        db, current_user.id, q, page, page_size, course_id, tag_id, sort, unresolved,
        created_from, created_before,
    )
    return ok({"items": [i.model_dump() for i in items], "total": total,
               "page": page, "page_size": page_size})


@router.get("/questions/{question_id}/related")
def related(
    question_id: int, current_user=Depends(get_current_user), db: Session = Depends(get_db),
) -> dict:
    items = service.related(db, question_id, current_user.id)
    return ok({"items": [i.model_dump() for i in items]})


@router.get("/courses")
def list_courses(
    page: int = Query(1, ge=1), page_size: int = Query(20, ge=1, le=100),
    keyword: str | None = Query(None), semester: str | None = Query(None),
    _current_user=Depends(get_current_user), db: Session = Depends(get_db),
) -> dict:
    items, total = service.list_courses(db, page, page_size, keyword, semester)
    return ok({"items": [i.model_dump() for i in items], "total": total,
               "page": page, "page_size": page_size})


@router.get("/courses/{course_id}")
def course_detail(
    course_id: int, current_user=Depends(get_current_user), db: Session = Depends(get_db),
) -> dict:
    return ok(service.course_detail(db, course_id, current_user.id).model_dump())


@router.get("/courses/{course_id}/questions")
def course_questions(
    course_id: int, page: int = Query(1, ge=1), page_size: int = Query(20, ge=1, le=100),
    tag_id: int | None = Query(None), sort: str = Query("latest", pattern="^(latest|hot)$"),
    unresolved: bool = Query(False), keyword: str | None = Query(None),
    created_from: datetime | None = Query(None), created_before: datetime | None = Query(None),
    current_user=Depends(get_current_user), db: Session = Depends(get_db),
) -> dict:
    items, total = service.course_questions(
        db, course_id, current_user.id, page, page_size, tag_id, sort, unresolved, keyword,
        created_from, created_before,
    )
    return ok({"items": [i.model_dump() for i in items], "total": total,
               "page": page, "page_size": page_size})
