# courses 领域规则：课程管理权限不变量、加入/退出边界与领域异常
# 铁律：零框架依赖——本文件不得 import fastapi / sqlalchemy / pydantic，可直接单测。
from datetime import date

from app.core.domain_error import DomainError

# ---------- 领域常量 ----------

ROLE_TEACHER = "teacher"
ROLE_ADMIN = "admin"

# ---------- 领域异常（http_status 由 core/errors.py 统一映射） ----------


class CourseNotFoundError(DomainError):
    """课程不存在。"""

    http_status = 404


class CourseCodeExistsError(DomainError):
    """课程编码已被使用（编码全局唯一）。"""

    http_status = 400


class CourseManageDeniedError(DomainError):
    """教师只能管理自己负责的课程（管理员除外，E-06 / T-03 完成判定）。"""

    http_status = 403


class CourseAlreadyJoinedError(DomainError):
    """已加入该课程，不能重复加入。"""

    http_status = 400


class CourseNotJoinedError(DomainError):
    """尚未加入该课程，无法退出。"""

    http_status = 400


# ---------- 不变量与规则 ----------


def ensure_can_manage(role: str, course_teacher_id: int, user_id: int) -> None:
    """不变量：仅课程负责教师与管理员可管理课程（编辑、查看成员，E-06）。

    学生、他人课程的教师一律拒绝——这是 T-03 的核心完成判定；
    管理员不受限（教师端接口文档 §1："管理员走同一接口不受此限"）。
    """
    if role == ROLE_ADMIN:
        return
    if role != ROLE_TEACHER or course_teacher_id != user_id:
        raise CourseManageDeniedError()


def ensure_not_joined(is_joined: bool) -> None:
    """不变量：同一学生对同一课程仅一条加入记录（重复加入拒绝）。"""
    if is_joined:
        raise CourseAlreadyJoinedError()


def ensure_joined(is_joined: bool) -> None:
    """不变量：退出课程前必须已加入。"""
    if not is_joined:
        raise CourseNotJoinedError()


# ---------- 知识树与教学计划（KN-R01/R03，Q-09 定案） ----------

KNOWLEDGE_NAME_MAX_LEN = 100
KNOWLEDGE_BATCH_MAX = 50
TEACHING_TITLE_MAX_LEN = 200
TEACHING_DETAIL_MAX_LEN = 2000
PLAN_ITEM_STATUSES = ("pending", "done")


class KnowledgeNameInvalidError(DomainError):
    """知识点名称为空或超长（E-02 同口径）。"""

    http_status = 400


class KnowledgeDuplicateError(DomainError):
    """同课程知识点重复（E-15：BST 不允许重复排序键）。"""

    http_status = 400


class KnowledgeNodeNotFoundError(DomainError):
    """知识点节点不存在或不属于该课程。"""

    http_status = 404


class KnowledgeNodeHasChildrenError(DomainError):
    """删除仍有子节点的知识点（E-16：先处理子节点）。"""

    http_status = 400


class TeachingPlanInvalidError(DomainError):
    """教学计划标题为空/超长、详情超长或状态非法。"""

    http_status = 400


class TeachingPlanNotFoundError(DomainError):
    """教学计划条目不存在或不属于该课程。"""

    http_status = 404


# BST 节点行：(id, sort_key, parent_id, position)；根节点 parent_id/position 为 None。
# 用元组而非 ORM 对象，保持 domain 零框架依赖、可直接单测。
NodeRow = tuple[int, str, int | None, str | None]


def normalize_sort_key(name: str) -> str:
    """BST 排序键：名称去首尾空白（"线程 "与"线程"视为同一知识点）。"""
    return name.strip()


def ensure_knowledge_name(name: str) -> None:
    """不变量：知识点名称非空且 ≤100 字。"""
    if not name.strip() or len(name) > KNOWLEDGE_NAME_MAX_LEN:
        raise KnowledgeNameInvalidError()


def ensure_plan_item_fields(
    title: str | None, detail: str | None, status: str | None
) -> None:
    """不变量：教学计划标题非空 ≤200、详情 ≤2000、状态属于 pending/done。

    三个参数均允许 None（部分更新语义：None 表示不修改该字段，不校验长度）。
    """
    if title is not None and (not title.strip() or len(title) > TEACHING_TITLE_MAX_LEN):
        raise TeachingPlanInvalidError()
    if detail is not None and len(detail) > TEACHING_DETAIL_MAX_LEN:
        raise TeachingPlanInvalidError()
    if status is not None and status not in PLAN_ITEM_STATUSES:
        raise TeachingPlanInvalidError()


def find_insert_position(
    nodes: list[NodeRow], sort_key: str
) -> tuple[int | None, str | None]:
    """在既有 BST 节点集合中为 sort_key 定位插入位：返回 (父节点 ID, 左/右位置)。

    空树返回 (None, None) 即新根；此后按二叉搜索树性质比较：
    sort_key 小于当前节点走左子、大于走右子、相等即重复（E-15）。
    同批多次插入时调用方须把已插入节点并入 nodes 再定位，保证批量插入仍满足 BST。
    """
    if not nodes:
        return None, None
    by_id = {row[0]: row for row in nodes}
    child_of = {
        (row[2], row[3]): row[0] for row in nodes if row[2] is not None and row[3] is not None
    }
    root = next((row for row in nodes if row[2] is None), None)
    if root is None:
        # 结构异常（存在节点却无根）视为不可插入，由上层重建或人工介入
        raise KnowledgeDuplicateError()
    current = root
    while True:
        if sort_key == current[1]:
            raise KnowledgeDuplicateError()
        side = "left" if sort_key < current[1] else "right"
        child_id = child_of.get((current[0], side))
        if child_id is None:
            return current[0], side
        current = by_id[child_id]


def ensure_node_is_leaf(nodes: list[NodeRow], node_id: int) -> None:
    """不变量：仅允许删除叶子节点（E-16；BST 中间节点删除需重排，不自动执行）。"""
    if any(row[2] == node_id for row in nodes):
        raise KnowledgeNodeHasChildrenError()


def inorder_ids(nodes: list[NodeRow]) -> list[int]:
    """中序遍历（左 → 根 → 右）：产出按 sort_key 升序的知识点 ID 序列。"""
    child_of = {
        (row[2], row[3]): row[0] for row in nodes if row[2] is not None and row[3] is not None
    }
    root = next((row for row in nodes if row[2] is None), None)
    if root is None:
        return []
    ordered: list[int] = []

    def visit(node_id: int) -> None:
        left = child_of.get((node_id, "left"))
        if left is not None:
            visit(left)
        ordered.append(node_id)
        right = child_of.get((node_id, "right"))
        if right is not None:
            visit(right)

    visit(root[0])
    return ordered


# ---------- 周报（KN-R02，Q-09③：系统每周自动生成） ----------

WEEKLY_CONTENT_MAX_LEN = 20000
WEEKLY_TOPIC_MAX = 50
WEEKLY_HEATMAP_MAX = 200
WEEKLY_RANGE_MAX_DAYS = 31


class WeeklyReportExistsError(DomainError):
    """同课程同周已有周报（E-18 幂等：调度重启不重复生成）。"""

    http_status = 409


class WeeklyReportNotFoundError(DomainError):
    """周报不存在或不属于该课程。"""

    http_status = 404


class WeeklyReportForbiddenError(DomainError):
    """周报仅课程负责教师本人可见（E-14：管理员不旁路，404 不暴露存在性）。"""

    http_status = 404


class WeeklyReportInvalidError(DomainError):
    """周报字段非法：周区间倒置/超长、正文空或超长、条目超上限。"""

    http_status = 400


def ensure_week_range(week_start: date, week_end: date) -> None:
    """不变量：周区间起点 ≤ 终点且跨度 ≤31 天（防调度异常拉全量数据）。"""
    if week_start > week_end or (week_end - week_start).days > WEEKLY_RANGE_MAX_DAYS:
        raise WeeklyReportInvalidError()


def ensure_report_fields(
    content: str, uncovered_count: int, heatmap_count: int
) -> None:
    """不变量：正文非空 ≤20000；未覆盖主题 ≤50；热力条目 ≤200。"""
    if not content.strip() or len(content) > WEEKLY_CONTENT_MAX_LEN:
        raise WeeklyReportInvalidError()
    if uncovered_count > WEEKLY_TOPIC_MAX or heatmap_count > WEEKLY_HEATMAP_MAX:
        raise WeeklyReportInvalidError()


def ensure_report_owner(course_teacher_id: int, user_id: int) -> None:
    """不变量：周报仅课程负责教师本人可读（E-14，Q-09④）。

    与课程管理权限不同：管理员不旁路——周报是教师私有分析，
    与运行归属私有口径一致（G-04-A），非本人一律 404。
    """
    if course_teacher_id != user_id:
        raise WeeklyReportForbiddenError()
