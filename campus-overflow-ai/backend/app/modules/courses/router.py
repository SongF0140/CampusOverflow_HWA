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
from app.modules.courses.schemas import (
    CourseCreateRequest,
    CourseUpdateRequest,
    KnowledgeNodesCreateRequest,
    TeachingPlanCreateRequest,
    TeachingPlanUpdateRequest,
)

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


# ---------- 知识树（KN-R01，Q-09④：师生可见） ----------


@courses_router.get("/{course_id}/knowledge-tree")
def get_knowledge_tree(
    course_id: int,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    """读取课程知识树：登录用户可读（随课程读取权限）；含树形与 BST 中序清单。"""
    tree = service.get_knowledge_tree(db, course_id)
    return ok(tree.model_dump())


@courses_router.post("/{course_id}/knowledge-tree/nodes")
def add_knowledge_nodes(
    course_id: int,
    req: KnowledgeNodesCreateRequest,
    teacher=Depends(require_roles("teacher")),
    db: Session = Depends(get_db),
) -> dict:
    """教师确认写入知识点（AI 建议确认与手动新增共用，E-17 唯一写入口）。

    仅课程负责教师与管理员（E-14）；重复知识点拒绝（E-15）。
    """
    tree = service.add_knowledge_nodes(
        db, teacher.role, teacher.id, course_id, req.names
    )
    return ok(tree.model_dump(), "知识点已写入知识树")


@courses_router.delete("/{course_id}/knowledge-tree/nodes/{node_id}")
def delete_knowledge_node(
    course_id: int,
    node_id: int,
    teacher=Depends(require_roles("teacher")),
    db: Session = Depends(get_db),
) -> dict:
    """删除知识树节点：仅叶子可删（E-16），非负责教师拒绝（E-14）。"""
    tree = service.delete_knowledge_node(
        db, teacher.role, teacher.id, course_id, node_id
    )
    return ok(tree.model_dump(), "知识点已删除")


# ---------- 教学计划（KN-R03，教师私有） ----------


@courses_router.get("/{course_id}/teaching-plan")
def list_teaching_plan(
    course_id: int,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    """教学计划列表：仅课程负责教师与管理员（E-14）。"""
    items = service.list_teaching_plan(db, current_user.role, current_user.id, course_id)
    return ok({"items": [i.model_dump() for i in items], "total": len(items)})


@courses_router.post("/{course_id}/teaching-plan")
def create_teaching_plan(
    course_id: int,
    req: TeachingPlanCreateRequest,
    teacher=Depends(require_roles("teacher")),
    db: Session = Depends(get_db),
) -> dict:
    """新增教学计划条目：手动创建或从周报差距一键加入（report_id 即周报来源）。"""
    item = service.create_teaching_plan(
        db, teacher.role, teacher.id, course_id, req.title, req.detail, req.report_id
    )
    return ok(item.model_dump(), "教学计划条目已创建")


@courses_router.patch("/{course_id}/teaching-plan/{item_id}")
def update_teaching_plan(
    course_id: int,
    item_id: int,
    req: TeachingPlanUpdateRequest,
    teacher=Depends(require_roles("teacher")),
    db: Session = Depends(get_db),
) -> dict:
    """编辑教学计划条目（标题/详情/状态部分更新）。"""
    item = service.update_teaching_plan(
        db, teacher.role, teacher.id, course_id, item_id,
        req.title, req.detail, req.status,
    )
    return ok(item.model_dump(), "教学计划条目已更新")


@courses_router.delete("/{course_id}/teaching-plan/{item_id}")
def delete_teaching_plan(
    course_id: int,
    item_id: int,
    teacher=Depends(require_roles("teacher")),
    db: Session = Depends(get_db),
) -> dict:
    """删除教学计划条目。"""
    service.delete_teaching_plan(db, teacher.role, teacher.id, course_id, item_id)
    return ok({"deleted": True}, "教学计划条目已删除")


# ---------- 周报（KN-R02；AX-P2 管理员继承全站教学管理） ----------


@courses_router.get("/{course_id}/weekly-reports")
def list_weekly_reports(
    course_id: int,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    """周报列表：课程负责教师与管理员可见。"""
    reports = service.list_weekly_reports(db, current_user.id, course_id)
    return ok(
        {"items": [r.model_dump() for r in reports], "total": len(reports)}
    )


@courses_router.get("/{course_id}/weekly-reports/{report_id}")
def get_weekly_report(
    course_id: int,
    report_id: int,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    """周报详情：课程负责教师与管理员可见。"""
    report = service.get_weekly_report(db, current_user.id, course_id, report_id)
    return ok(report.model_dump())
