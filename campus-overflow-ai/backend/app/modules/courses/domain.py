# courses 领域规则：课程管理权限不变量、加入/退出边界与领域异常
# 铁律：零框架依赖——本文件不得 import fastapi / sqlalchemy / pydantic，可直接单测。
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
