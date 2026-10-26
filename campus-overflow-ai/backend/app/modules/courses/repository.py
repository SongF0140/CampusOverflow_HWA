# courses 数据访问：查询与写入函数，仅被本模块 service 调用（架构规则 2.3-3）
# 分层基线 D-2：本文件是模块内唯一允许 import models 的地方；出参一律 schemas。
# 事务约定 D-8：本层只 flush 不 commit，事务边界（commit）在 service 用例层。
from datetime import date, datetime

from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from app.modules.courses import domain
from app.modules.courses.models import (
    Course,
    CourseKnowledgeNode,
    CourseMember,
    TeacherWeeklyReport,
    TeachingPlanItem,
)
from app.modules.courses.schemas import (
    CourseResponse,
    KnowledgeNodeResponse,
    TeachingPlanItemResponse,
    WeeklyReportResponse,
)


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


# ---------- 知识树（KN-R01） ----------


def list_knowledge_nodes(
    db: Session, course_id: int
) -> list[KnowledgeNodeResponse]:
    """列出课程全部知识树节点（BST 结构装配在 service/domain 层完成）。"""
    nodes = (
        db.query(CourseKnowledgeNode)
        .filter(CourseKnowledgeNode.course_id == course_id)
        .order_by(CourseKnowledgeNode.id.asc())
        .all()
    )
    return [KnowledgeNodeResponse.model_validate(n) for n in nodes]


def add_knowledge_nodes(
    db: Session,
    course_id: int,
    items: list[tuple[str, str, int | None, str | None, str, int]],
) -> None:
    """批量写入知识点节点：(名称, sort_key, parent_id, position, source, created_by)。

    插入位（父节点与左右位置）由 domain.find_insert_position 预先确定。
    """
    for name, sort_key, parent_id, position, source, created_by in items:
        db.add(
            CourseKnowledgeNode(
                course_id=course_id,
                name=name,
                sort_key=sort_key,
                parent_id=parent_id,
                position=position,
                source=source,
                created_by=created_by,
            )
        )
    db.flush()


def get_knowledge_node(
    db: Session, node_id: int
) -> CourseKnowledgeNode | None:
    """按主键取知识树节点 ORM 对象（删除前校验归属用）。"""
    return db.get(CourseKnowledgeNode, node_id)


def delete_knowledge_node(db: Session, node_id: int) -> None:
    """删除知识树叶子节点（是否叶子由 domain.ensure_node_is_leaf 先行校验）。"""
    node = db.get(CourseKnowledgeNode, node_id)
    if node is not None:
        db.delete(node)
    db.flush()


# ---------- 教学计划（KN-R03） ----------


def list_plan_items(db: Session, course_id: int) -> list[TeachingPlanItemResponse]:
    """列出课程全部教学计划条目（按创建时间倒序，最新在前）。"""
    items = (
        db.query(TeachingPlanItem)
        .filter(TeachingPlanItem.course_id == course_id)
        .order_by(TeachingPlanItem.created_at.desc(), TeachingPlanItem.id.desc())
        .all()
    )
    return [TeachingPlanItemResponse.model_validate(i) for i in items]


def create_plan_item(
    db: Session,
    course_id: int,
    teacher_id: int,
    title: str,
    detail: str | None,
    source: str,
    report_id: int | None,
) -> TeachingPlanItemResponse:
    """新建教学计划条目（source：manual=手动，report=周报差距加入）。"""
    item = TeachingPlanItem(
        course_id=course_id,
        teacher_id=teacher_id,
        title=title,
        detail=detail,
        source=source,
        report_id=report_id,
        status="pending",
    )
    db.add(item)
    db.flush()
    return TeachingPlanItemResponse.model_validate(item)


def get_plan_item(db: Session, item_id: int) -> TeachingPlanItem | None:
    """按主键取教学计划条目 ORM 对象（编辑/删除前校验归属用）。"""
    return db.get(TeachingPlanItem, item_id)


def update_plan_item(
    db: Session,
    item_id: int,
    title: str | None,
    detail: str | None,
    status: str | None,
) -> TeachingPlanItemResponse:
    """编辑教学计划条目（None 表示不修改；合法性由 domain 先行校验）。"""
    item = db.get(TeachingPlanItem, item_id)
    if item is None:
        raise domain.TeachingPlanNotFoundError()
    if title is not None:
        item.title = title
    if detail is not None:
        item.detail = detail
    if status is not None:
        item.status = status
    db.flush()
    return TeachingPlanItemResponse.model_validate(item)


def delete_plan_item(db: Session, item_id: int) -> None:
    """删除教学计划条目。"""
    item = db.get(TeachingPlanItem, item_id)
    if item is not None:
        db.delete(item)
    db.flush()


# ---------- 周报（KN-R02） ----------


def list_weekly_reports(db: Session, course_id: int) -> list[WeeklyReportResponse]:
    """列出课程全部周报（最新在前）。"""
    reports = (
        db.query(TeacherWeeklyReport)
        .filter(TeacherWeeklyReport.course_id == course_id)
        .order_by(
            TeacherWeeklyReport.week_start.desc(), TeacherWeeklyReport.id.desc()
        )
        .all()
    )
    return [WeeklyReportResponse.model_validate(r) for r in reports]


def get_weekly_report(db: Session, report_id: int) -> TeacherWeeklyReport | None:
    """按主键取周报 ORM 对象（归属校验在 service）。"""
    return db.get(TeacherWeeklyReport, report_id)


def create_weekly_report(
    db: Session,
    course_id: int,
    teacher_id: int,
    week_start: date,
    week_end: date,
    content: str,
    uncovered_topics: list[dict],
    heatmap: list[dict],
    question_count: int,
    agent_run_id: str,
) -> WeeklyReportResponse:
    """保存周报；同课程同周唯一冲突由 IntegrityError 上抛（service 转 409，E-18）。"""
    report = TeacherWeeklyReport(
        course_id=course_id,
        teacher_id=teacher_id,
        week_start=week_start,
        week_end=week_end,
        content=content,
        uncovered_topics=uncovered_topics,
        heatmap=heatmap,
        question_count=question_count,
        agent_run_id=agent_run_id,
    )
    db.add(report)
    db.flush()
    return WeeklyReportResponse.model_validate(report)


def list_knowledge_tree_courses(db: Session) -> list[tuple[int, int]]:
    """有知识树的课程清单：(course_id, teacher_id) 去重，按课程 ID 升序（调度扫描）。"""
    rows = (
        db.query(CourseKnowledgeNode.course_id, Course.teacher_id)
        .join(Course, Course.id == CourseKnowledgeNode.course_id)
        .distinct()
        .order_by(CourseKnowledgeNode.course_id.asc())
        .all()
    )
    return [(course_id, teacher_id) for course_id, teacher_id in rows]
