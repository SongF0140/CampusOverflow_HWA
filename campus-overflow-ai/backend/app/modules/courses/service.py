# courses 业务层：用例编排、事务边界与授权决策
# 分层基线 D-1/D-2/D-3：规则在 domain.py，ORM 留在 repository，本层不碰 HTTP 协议。
# 签名约定 D-7：入参只收基本类型（请求 schema 的拆字段留在 router）；
# 事务约定 D-8：写用例末尾显式 db.commit()，repository 只 flush 不提交。
from datetime import date

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.modules.courses import domain, repository
from app.modules.courses.schemas import (
    CourseAggregatesResponse,
    CourseDetailResponse,
    CourseListItemResponse,
    CourseResponse,
    KnowledgeNodeResponse,
    KnowledgeTreeCourseItem,
    KnowledgeTreeNodeResponse,
    KnowledgeTreeResponse,
    MemberItemResponse,
    TeachingPlanItemResponse,
    WeeklyReportResponse,
)
from app.modules.identity import service as identity_service


def get_course(db: Session, course_id: int) -> CourseResponse | None:
    """跨模块公开函数（分层基线 D-5）：按 ID 查课程基础信息，供 qa 等模块校验。"""
    return repository.get_by_id(db, course_id)


def teacher_membership_snapshot(
    db: Session, teacher_id: int, course_id: int, student_ids: list[int],
) -> dict:
    """负责教师的成员变更预览，锁课程供调用方同事务核对与变更。"""
    teacher = identity_service.get_by_id(db, teacher_id)
    course = repository.get_by_id(db, course_id, for_update=True)
    if course is None:
        raise domain.CourseNotFoundError()
    if teacher.status != "active":
        raise domain.CourseManageDeniedError()
    domain.ensure_can_manage(teacher.role, course.teacher_id, teacher_id)
    students = []
    for student_id in student_ids:
        student = identity_service.get_by_id(db, student_id)
        if student.role != "student" or student.status != "active":
            raise domain.CourseManageDeniedError()
        students.append({"user_id": student_id, "username": student.username,
                         "role": student.role, "status": student.status,
                         "joined": repository.is_member(db, course_id, student_id)})
    return {"course_id": course_id, "course_name": course.name, "students": students}


def prepare_teacher_memberships(
    db: Session, teacher_id: int, course_id: int, student_ids: list[int], action: str,
) -> None:
    """名单写入只 flush，审批状态与审计由治理用例统一提交。"""
    snapshot = teacher_membership_snapshot(db, teacher_id, course_id, student_ids)
    for student in snapshot["students"]:
        if action == "add" and not student["joined"]:
            repository.join_course(db, course_id, student["user_id"])
        elif action == "remove" and student["joined"]:
            repository.leave_course(db, course_id, student["user_id"])


def get_course_names_by_ids(db: Session, course_ids: list[int]) -> dict[int, str]:
    """跨模块公开函数（分层基线 D-5）：批量取课程 id→名称，供 qa 列表/详情回填。"""
    return repository.get_course_names_by_ids(db, course_ids)


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
    db: Session, page: int, page_size: int, keyword: str | None, semester: str | None,
    mine: bool = False, viewer_id: int | None = None,
) -> tuple[list[CourseListItemResponse], int]:
    """课程列表：教师名跨模块批量取（一次 in 查询），成员数一次 GROUP BY。

    mine=true 只返回当前用户负责的课程（教师端"我的课程"）；joined 批量判定当前用户加入态。
    """
    courses, counts, total = repository.list_courses(
        db, page, page_size, keyword, semester, mine, viewer_id
    )
    names = identity_service.get_usernames_by_ids(db, [c.teacher_id for c in courses])
    joined_ids = repository.member_course_ids(db, viewer_id, [c.id for c in courses])
    items = [
        CourseListItemResponse(
            id=c.id,
            name=c.name,
            code=c.code,
            teacher_name=names.get(c.teacher_id, ""),
            member_count=counts.get(c.id, 0),
            joined=c.id in joined_ids,
            created_at=c.created_at,
        )
        for c in courses
    ]
    return items, total


def get_detail(db: Session, course_id: int, user_id: int) -> CourseDetailResponse:
    """课程详情：joined 为当前用户加入状态；is_owner/can_post 判定发布资格。

    can_post 与 qa 发布资格口径一致（负责教师或已加入），前端据此显示发布入口。
    四聚合区块随 T-04/T-07/T-08 回填。
    """
    course = repository.get_by_id(db, course_id)
    if course is None:
        raise domain.CourseNotFoundError()
    names = identity_service.get_usernames_by_ids(db, [course.teacher_id])
    joined = repository.is_member(db, course_id, user_id)
    is_owner = course.teacher_id == user_id
    return CourseDetailResponse(
        id=course.id,
        name=course.name,
        code=course.code,
        description=course.description,
        semester=course.semester,
        teacher_name=names.get(course.teacher_id, ""),
        joined=joined,
        is_owner=is_owner,
        can_post=is_owner or joined or identity_service.get_by_id(db, user_id).role == "admin",
        aggregates=CourseAggregatesResponse(),
        created_at=course.created_at,
    )


def join_course(db: Session, course_id: int, user_id: int) -> None:
    """学生加入课程：课程须存在且未加入（重复加入 400）。"""
    if repository.get_by_id(db, course_id, for_update=True) is None:
        raise domain.CourseNotFoundError()
    domain.ensure_not_joined(repository.is_member(db, course_id, user_id))
    repository.join_course(db, course_id, user_id)
    db.commit()


def leave_course(db: Session, course_id: int, user_id: int) -> None:
    """学生退出课程：课程须存在且已加入（未加入 400）。"""
    if repository.get_by_id(db, course_id, for_update=True) is None:
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


# ---------- 知识树（KN-R01，Q-09 定案） ----------


def _node_rows(
    nodes: list[KnowledgeNodeResponse],
) -> list[domain.NodeRow]:
    """响应对象转 domain 节点行（零框架依赖的 BST 运算输入）。"""
    return [(n.id, n.sort_key, n.parent_id, n.position) for n in nodes]


def _build_tree(
    nodes: list[KnowledgeNodeResponse],
) -> list[KnowledgeTreeNodeResponse]:
    """扁平节点装配为嵌套树形（根级列表；前端递归渲染 children）。"""
    children_map: dict[int | None, list[KnowledgeNodeResponse]] = {}
    for node in nodes:
        children_map.setdefault(node.parent_id, []).append(node)
    by_id = {n.id: n for n in nodes}

    def assemble(node: KnowledgeNodeResponse) -> KnowledgeTreeNodeResponse:
        return KnowledgeTreeNodeResponse(
            id=node.id,
            name=node.name,
            sort_key=node.sort_key,
            position=node.position,
            source=node.source,
            children=[assemble(by_id[c.id]) for c in children_map.get(node.id, [])],
        )

    return [assemble(root) for root in children_map.get(None, [])]


def _tree_response(
    course_id: int, nodes: list[KnowledgeNodeResponse]
) -> KnowledgeTreeResponse:
    """统一装配：扁平节点 + 嵌套树形 + BST 中序（sort_key 升序）清单。"""
    ordered = domain.inorder_ids(_node_rows(nodes))
    by_id = {n.id: n for n in nodes}
    return KnowledgeTreeResponse(
        course_id=course_id,
        nodes=nodes,
        tree=_build_tree(nodes),
        inorder=[by_id[i] for i in ordered],
    )


def get_knowledge_tree(db: Session, course_id: int) -> KnowledgeTreeResponse:
    """读取课程知识树：课程须存在；树随课程读取权限对登录用户开放（Q-09④）。"""
    if repository.get_by_id(db, course_id) is None:
        raise domain.CourseNotFoundError()
    return _tree_response(course_id, repository.list_knowledge_nodes(db, course_id))


def add_knowledge_nodes(
    db: Session, user_role: str, user_id: int, course_id: int, names: list[str]
) -> KnowledgeTreeResponse:
    """教师确认写入知识点（AI 建议确认与手动新增共用，E-17 唯一写入口）。

    逐个按 BST 性质定位插入位（同批插入亦保持左小右大）；
    与现有树或同批重复的名称拒绝（E-15），单批数量与名称长度受 domain 上限约束。
    """
    course = repository.get_by_id(db, course_id)
    if course is None:
        raise domain.CourseNotFoundError()
    domain.ensure_can_manage(user_role, course.teacher_id, user_id)
    if len(names) > domain.KNOWLEDGE_BATCH_MAX:
        raise domain.KnowledgeNameInvalidError()

    nodes = repository.list_knowledge_nodes(db, course_id)
    rows = _node_rows(nodes)
    next_id = max((n.id for n in nodes), default=0) + 1
    items: list[tuple[str, str, int | None, str | None, str, int]] = []
    for raw_name in names:
        domain.ensure_knowledge_name(raw_name)
        sort_key = domain.normalize_sort_key(raw_name)
        parent_id, position = domain.find_insert_position(rows, sort_key)
        # 同批先定位的节点并入集合，后续插入继续满足 BST（新节点 ID 用预分配占位值）
        rows.append((next_id, sort_key, parent_id, position))
        items.append((raw_name.strip(), sort_key, parent_id, position, "teacher", user_id))
        next_id += 1
    repository.add_knowledge_nodes(db, course_id, items)
    db.commit()
    return _tree_response(course_id, repository.list_knowledge_nodes(db, course_id))


def delete_knowledge_node(
    db: Session, user_role: str, user_id: int, course_id: int, node_id: int
) -> KnowledgeTreeResponse:
    """删除知识树节点：仅负责教师/管理员，且必须为叶子（E-16）。"""
    course = repository.get_by_id(db, course_id)
    if course is None:
        raise domain.CourseNotFoundError()
    domain.ensure_can_manage(user_role, course.teacher_id, user_id)
    nodes = repository.list_knowledge_nodes(db, course_id)
    if not any(n.id == node_id for n in nodes):
        raise domain.KnowledgeNodeNotFoundError()
    domain.ensure_node_is_leaf(_node_rows(nodes), node_id)
    repository.delete_knowledge_node(db, node_id)
    db.commit()
    return _tree_response(course_id, repository.list_knowledge_nodes(db, course_id))


# ---------- 教学计划（KN-R03） ----------


def _ensure_course_manageable(
    db: Session, user_role: str, user_id: int, course_id: int
) -> None:
    """教学计划/知识树管理的公共前置：课程存在且当前用户可管理（E-14）。"""
    course = repository.get_by_id(db, course_id)
    if course is None:
        raise domain.CourseNotFoundError()
    domain.ensure_can_manage(user_role, course.teacher_id, user_id)


def list_teaching_plan(
    db: Session, user_role: str, user_id: int, course_id: int
) -> list[TeachingPlanItemResponse]:
    """教学计划列表：仅负责教师与管理员（E-14；教师私有教学工具）。"""
    _ensure_course_manageable(db, user_role, user_id, course_id)
    return repository.list_plan_items(db, course_id)


def create_teaching_plan(
    db: Session,
    user_role: str,
    user_id: int,
    course_id: int,
    title: str,
    detail: str | None,
    report_id: int | None,
) -> TeachingPlanItemResponse:
    """新增教学计划条目：提供 report_id 即标记周报差距来源（KN-R03 一键加入）。

    report_id 必须指向本课程已存在的周报（防止跨课程引用伪造来源）。
    """
    _ensure_course_manageable(db, user_role, user_id, course_id)
    if report_id is not None:
        report = repository.get_weekly_report(db, report_id)
        if report is None or report.course_id != course_id:
            raise domain.WeeklyReportNotFoundError()
    domain.ensure_plan_item_fields(title, detail, None)
    source = "report" if report_id is not None else "manual"
    item = repository.create_plan_item(
        db, course_id, user_id, title, detail, source, report_id
    )
    db.commit()
    return item


def update_teaching_plan(
    db: Session,
    user_role: str,
    user_id: int,
    course_id: int,
    item_id: int,
    title: str | None,
    detail: str | None,
    status: str | None,
) -> TeachingPlanItemResponse:
    """编辑教学计划条目（标题/详情/状态部分更新；None 不修改）。"""
    _ensure_course_manageable(db, user_role, user_id, course_id)
    item = repository.get_plan_item(db, item_id)
    if item is None or item.course_id != course_id:
        raise domain.TeachingPlanNotFoundError()
    domain.ensure_plan_item_fields(title, detail, status)
    updated = repository.update_plan_item(db, item_id, title, detail, status)
    db.commit()
    return updated


def delete_teaching_plan(
    db: Session, user_role: str, user_id: int, course_id: int, item_id: int
) -> None:
    """删除教学计划条目。"""
    _ensure_course_manageable(db, user_role, user_id, course_id)
    item = repository.get_plan_item(db, item_id)
    if item is None or item.course_id != course_id:
        raise domain.TeachingPlanNotFoundError()
    repository.delete_plan_item(db, item_id)
    db.commit()


# ---------- 周报（KN-R02） ----------


def list_weekly_reports(
    db: Session, user_id: int, course_id: int
) -> list[WeeklyReportResponse]:
    """周报列表：负责教师或全站管理员；私人会话与记忆不因此开放。"""
    course = repository.get_by_id(db, course_id)
    if course is None:
        raise domain.CourseNotFoundError()
    domain.ensure_report_owner(
        course.teacher_id, user_id, identity_service.get_by_id(db, user_id).role,
    )
    return repository.list_weekly_reports(db, course_id)


def get_weekly_report(
    db: Session, user_id: int, course_id: int, report_id: int
) -> WeeklyReportResponse:
    """周报详情：负责教师或管理员；跨课程伪造报告 ID 仍 404。"""
    course = repository.get_by_id(db, course_id)
    if course is None:
        raise domain.CourseNotFoundError()
    domain.ensure_report_owner(
        course.teacher_id, user_id, identity_service.get_by_id(db, user_id).role,
    )
    report = repository.get_weekly_report(db, report_id)
    if report is None or report.course_id != course_id:
        raise domain.WeeklyReportNotFoundError()
    return WeeklyReportResponse.model_validate(report)


def save_weekly_report(
    db: Session,
    course_id: int,
    week_start: date,
    week_end: date,
    content: str,
    uncovered_topics: list[dict],
    heatmap: list[dict],
    question_count: int,
    agent_run_id: str,
) -> WeeklyReportResponse:
    """保存周报（内部接口用，系统调度运行）：同课程同周唯一（E-18，冲突 409）。

    归属教师取课程当前负责教师（快照入库）；字段合法性与周区间由 domain 校验；
    并发重复插入由唯一约束兜底并转为 409。
    """
    course = repository.get_by_id(db, course_id)
    if course is None:
        raise domain.CourseNotFoundError()
    domain.ensure_week_range(week_start, week_end)
    domain.ensure_report_fields(content, len(uncovered_topics), len(heatmap))
    if question_count < 0:
        raise domain.WeeklyReportInvalidError()
    try:
        report = repository.create_weekly_report(
            db, course_id, course.teacher_id, week_start, week_end,
            content, uncovered_topics, heatmap, question_count, agent_run_id,
        )
    except IntegrityError:
        db.rollback()
        raise domain.WeeklyReportExistsError() from None
    db.commit()
    return report


def list_knowledge_tree_courses(db: Session) -> list[KnowledgeTreeCourseItem]:
    """有知识树的课程清单（内部调度扫描；E-19 无树课程不进清单）。"""
    return [
        KnowledgeTreeCourseItem(course_id=course_id, teacher_id=teacher_id)
        for course_id, teacher_id in repository.list_knowledge_tree_courses(db)
    ]
