# courses 路由层：入参出参校验、权限依赖注入、调 service、返回统一响应
# 分层基线 D-2/D-9：本层不 import models、不触碰 ORM；当前用户一律 UserPrincipal。
# 课程读接口（列表/详情/课程问题）由 discovery 提供增强聚合版本（T-09），
# 本层只保留写与成员管理。
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.core.permissions import get_current_user, require_roles
from app.core.response import ok
from app.db.session import get_db
from app.modules.courses import service
from app.modules.courses.schemas import CourseCreateRequest, CourseUpdateRequest

courses_router = APIRouter(prefix="/api/courses", tags=["课程"])


@courses_router.post("")
def create_course(
    req: CourseCreateRequest,
    teacher=Depends(require_roles("teacher")),
    db: Session = Depends(get_db),
) -> dict:
    """教师创建课程：创建者自动成为负责教师（教师端接口文档 §1）。"""
    course = service.create_course(
        db, teacher.id, req.name, req.code, req.description, req.semester
    )
    return ok(course.model_dump(), "课程创建成功")


@courses_router.patch("/{course_id}")
def update_course(
    course_id: int,
    req: CourseUpdateRequest,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    """编辑课程：仅负责教师与管理员（E-06：他人课程教师 403）。"""
    course = service.update_course(
        db, current_user.role, current_user.id, course_id,
        req.name, req.description, req.semester,
    )
    return ok(course.model_dump(), "课程更新成功")


@courses_router.post("/{course_id}/join")
def join_course(
    course_id: int,
    student=Depends(require_roles("student")),
    db: Session = Depends(get_db),
) -> dict:
    """学生加入课程：重复加入 400（学生端接口文档 §2）。"""
    service.join_course(db, course_id, student.id)
    return ok({"joined": True}, "已加入课程")


@courses_router.delete("/{course_id}/members/me")
def leave_course(
    course_id: int,
    student=Depends(require_roles("student")),
    db: Session = Depends(get_db),
) -> dict:
    """学生退出课程（仅本人）：未加入 400（学生端接口文档 §2）。"""
    service.leave_course(db, course_id, student.id)
    return ok({"joined": False}, "已退出课程")


@courses_router.get("/{course_id}/members")
def list_members(
    course_id: int,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    """课程成员列表：仅负责教师与管理员（教师端接口文档 §1，E-06）。"""
    items, total = service.list_members(
        db, current_user.role, current_user.id, course_id, page, page_size
    )
    data = {
        "items": [i.model_dump() for i in items],
        "total": total,
        "page": page,
        "page_size": page_size,
    }
    return ok(data)
