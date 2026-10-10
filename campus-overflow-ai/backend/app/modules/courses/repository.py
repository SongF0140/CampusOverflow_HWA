# courses 数据访问：查询与写入函数，仅被本模块 service 调用（架构规则 2.3-3）
# 分层基线 D-2：本文件是模块内唯一允许 import models 的地方；出参一律 schemas。
# 事务约定 D-8：本层只 flush 不 commit，事务边界（commit）在 service 用例层。
from datetime import datetime

from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from app.modules.courses import domain
from app.modules.courses.models import Course, CourseMember
from app.modules.courses.schemas import CourseResponse


def get_by_id(db: Session, course_id: int) -> CourseResponse | None:
    """按主键查询课程，不存在返回 None。"""
    course = db.get(Course, course_id)
    return CourseResponse.model_validate(course) if course else None


def code_exists(db: Session, code: str) -> bool:
    """创建/编辑前校验课程编码是否已被占用（编码全局唯一）。"""
    return db.query(Course).filter(Course.code == code).first() is not None


def create_course(
    db: Session, name: str, code: str, description: str | None,
    semester: str | None, teacher_id: int,
) -> CourseResponse:
    """新建课程，创建者自动成为负责教师。"""
    course = Course(
        name=name, code=code, description=description,
        semester=semester, teacher_id=teacher_id,
    )
    db.add(course)
    db.flush()
    return CourseResponse.model_validate(course)


def update_course(
    db: Session, course_id: int, name: str | None,
    description: str | None, semester: str | None,
) -> CourseResponse:
    """编辑课程字段（None 表示不修改，与 identity.update_profile 同约定）。"""
    course = db.get(Course, course_id)
    if course is None:
        raise domain.CourseNotFoundError()
    if name is not None:
        course.name = name
    if description is not None:
        course.description = description
    if semester is not None:
        course.semester = semester
    db.flush()
    return CourseResponse.model_validate(course)


def count_members_by_course(db: Session, course_ids: list[int]) -> dict[int, int]:
    """批量统计各课程成员数（列表页一次 GROUP BY，避免逐课程查询）。"""
    if not course_ids:
        return {}
    rows = (
        db.query(CourseMember.course_id, func.count(CourseMember.id))
        .filter(CourseMember.course_id.in_(course_ids))
        .group_by(CourseMember.course_id)
        .all()
    )
    return {course_id: count for course_id, count in rows}


def list_courses(
    db: Session, page: int, page_size: int,
    keyword: str | None, semester: str | None,
    mine: bool = False, viewer_id: int | None = None,
) -> tuple[list[CourseResponse], dict[int, int], int]:
    """分页列课程，支持名称/编码模糊搜索与学期精确筛选；附带各课程成员数。

    mine=true 时仅返回当前用户负责（teacher_id == viewer_id）的课程。
    """
    query = db.query(Course)
    if keyword:
        like = f"%{keyword}%"
        query = query.filter(or_(Course.name.like(like), Course.code.like(like)))
    if semester:
        query = query.filter(Course.semester == semester)
    if mine and viewer_id is not None:
        query = query.filter(Course.teacher_id == viewer_id)
    total = query.count()
    offset = (page - 1) * page_size
    courses = query.order_by(Course.id.asc()).offset(offset).limit(page_size).all()
    counts = count_members_by_course(db, [c.id for c in courses])
    return [CourseResponse.model_validate(c) for c in courses], counts, total


def get_course_names_by_ids(db: Session, course_ids: list[int]) -> dict[int, str]:
    """批量取课程 id→名称映射（qa 列表/详情回填 course_name，一次查询避免 N+1）。"""
    if not course_ids:
        return {}
    rows = db.query(Course.id, Course.name).filter(Course.id.in_(course_ids)).all()
    return {course_id: name for course_id, name in rows}


def member_course_ids(db: Session, user_id: int | None, course_ids: list[int]) -> set[int]:
    """批量判当前用户加入了哪些课程（列表页 joined 标志，一次查询避免 N 次 is_member）。"""
    if user_id is None or not course_ids:
        return set()
    rows = (
        db.query(CourseMember.course_id)
        .filter(CourseMember.user_id == user_id, CourseMember.course_id.in_(course_ids))
        .all()
    )
    return {course_id for (course_id,) in rows}


def is_member(db: Session, course_id: int, user_id: int) -> bool:
    """判断用户是否已加入课程（加入/退出前校验 + 详情页 joined 字段）。"""
    return (
        db.query(CourseMember)
        .filter(CourseMember.course_id == course_id, CourseMember.user_id == user_id)
        .first()
        is not None
    )


def join_course(db: Session, course_id: int, user_id: int) -> None:
    """写入加入记录（重复加入由 domain.ensure_not_joined 在 service 层拦截）。"""
    db.add(CourseMember(course_id=course_id, user_id=user_id))
    db.flush()


def leave_course(db: Session, course_id: int, user_id: int) -> None:
    """删除加入记录（未加入由 domain.ensure_joined 在 service 层拦截）。"""
    db.query(CourseMember).filter(
        CourseMember.course_id == course_id, CourseMember.user_id == user_id
    ).delete()
    db.flush()


def list_members(
    db: Session, course_id: int, page: int, page_size: int
) -> tuple[list[tuple[int, datetime]], int]:
    """分页列出课程成员（user_id 与加入时间，用户名由 service 跨模块补充）。"""
    query = db.query(CourseMember).filter(CourseMember.course_id == course_id)
    total = query.count()
    offset = (page - 1) * page_size
    members = (
        query.order_by(CourseMember.joined_at.asc()).offset(offset).limit(page_size).all()
    )
    return [(m.user_id, m.joined_at) for m in members], total
