# courses 业务层：用例编排、事务边界与授权决策
# 分层基线 D-1/D-2/D-3：规则在 domain.py，ORM 留在 repository，本层不碰 HTTP 协议。
# 签名约定 D-7：入参只收基本类型（请求 schema 的拆字段留在 router）；
# 事务约定 D-8：写用例末尾显式 db.commit()，repository 只 flush 不提交。
from sqlalchemy.orm import Session

from app.modules.courses import domain, repository
from app.modules.courses.schemas import (
    CourseAggregatesResponse,
    CourseDetailResponse,
    CourseListItemResponse,
    CourseResponse,
    MemberItemResponse,
)
from app.modules.identity import service as identity_service


def get_course(db: Session, course_id: int) -> CourseResponse | None:
    """跨模块公开函数（分层基线 D-5）：按 ID 查课程基础信息，供 qa 等模块校验。"""
    return repository.get_by_id(db, course_id)


def is_member(db: Session, course_id: int, user_id: int) -> bool:
    """跨模块公开函数（分层基线 D-5）：查询用户是否已加入课程。"""
    return repository.is_member(db, course_id, user_id)


def create_course(
    db: Session, teacher_id: int, name: str, code: str,
    description: str | None, semester: str | None,
) -> CourseResponse:
    """教师创建课程：编码全局唯一，创建者自动成为负责教师（教师端接口文档 §1）。"""
    if repository.code_exists(db, code):
        raise domain.CourseCodeExistsError()
    course = repository.create_course(db, name, code, description, semester, teacher_id)
    db.commit()
    return course


def update_course(
    db: Session, user_role: str, user_id: int, course_id: int,
    name: str | None, description: str | None, semester: str | None,
) -> CourseResponse:
    """编辑课程：仅负责教师与管理员（E-06，T-03 核心完成判定）。

    编码不在可编辑字段内（接口契约仅 name/description/semester，编码是课程标识）。
    """
    course = repository.get_by_id(db, course_id)
    if course is None:
        raise domain.CourseNotFoundError()
    domain.ensure_can_manage(user_role, course.teacher_id, user_id)
    updated = repository.update_course(db, course_id, name, description, semester)
    db.commit()
    return updated


def list_courses(
    db: Session, page: int, page_size: int, keyword: str | None, semester: str | None
) -> tuple[list[CourseListItemResponse], int]:
    """课程列表：教师名跨模块批量取（一次 in 查询），成员数一次 GROUP BY。"""
    courses, counts, total = repository.list_courses(db, page, page_size, keyword, semester)
    names = identity_service.get_usernames_by_ids(db, [c.teacher_id for c in courses])
    items = [
        CourseListItemResponse(
            id=c.id,
            name=c.name,
            code=c.code,
            teacher_name=names.get(c.teacher_id, ""),
            member_count=counts.get(c.id, 0),
            created_at=c.created_at,
        )
        for c in courses
    ]
    return items, total


def get_detail(db: Session, course_id: int, user_id: int) -> CourseDetailResponse:
    """课程详情：joined 为当前用户加入状态；四聚合区块随 T-04/T-07/T-08 回填。"""
    course = repository.get_by_id(db, course_id)
    if course is None:
        raise domain.CourseNotFoundError()
    names = identity_service.get_usernames_by_ids(db, [course.teacher_id])
    return CourseDetailResponse(
        id=course.id,
        name=course.name,
        code=course.code,
        description=course.description,
        semester=course.semester,
        teacher_name=names.get(course.teacher_id, ""),
        joined=repository.is_member(db, course_id, user_id),
        aggregates=CourseAggregatesResponse(),
        created_at=course.created_at,
    )


def join_course(db: Session, course_id: int, user_id: int) -> None:
    """学生加入课程：课程须存在且未加入（重复加入 400）。"""
    if repository.get_by_id(db, course_id) is None:
        raise domain.CourseNotFoundError()
    domain.ensure_not_joined(repository.is_member(db, course_id, user_id))
    repository.join_course(db, course_id, user_id)
    db.commit()


def leave_course(db: Session, course_id: int, user_id: int) -> None:
    """学生退出课程：课程须存在且已加入（未加入 400）。"""
    if repository.get_by_id(db, course_id) is None:
        raise domain.CourseNotFoundError()
    domain.ensure_joined(repository.is_member(db, course_id, user_id))
    repository.leave_course(db, course_id, user_id)
    db.commit()


def list_members(
    db: Session, user_role: str, user_id: int, course_id: int, page: int, page_size: int
) -> tuple[list[MemberItemResponse], int]:
    """课程成员列表：仅负责教师与管理员可查（E-06）。"""
    course = repository.get_by_id(db, course_id)
    if course is None:
        raise domain.CourseNotFoundError()
    domain.ensure_can_manage(user_role, course.teacher_id, user_id)
    rows, total = repository.list_members(db, course_id, page, page_size)
    names = identity_service.get_usernames_by_ids(db, [uid for uid, _ in rows])
    items = [
        MemberItemResponse(user_id=uid, username=names.get(uid, ""), joined_at=joined_at)
        for uid, joined_at in rows
    ]
    return items, total
