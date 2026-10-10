# identity 领域规则：账号状态机、不变量与领域异常
# 铁律：零框架依赖——本文件不得 import fastapi / sqlalchemy / pydantic，可直接单测。
from app.core.domain_error import DomainError

# ---------- 领域常量 ----------

ROLE_STUDENT = "student"
ROLE_TEACHER = "teacher"
ROLE_ADMIN = "admin"

STATUS_ACTIVE = "active"
STATUS_BANNED = "banned"

# 身份类型：助教能力位的身份前提（Q-07，研究生不是独立角色）
IDENTITY_UNDERGRADUATE = "undergraduate"
IDENTITY_POSTGRADUATE = "postgraduate"

# 助教认证状态：none 未申请 / pending 待审核 / approved 通过 / rejected 已驳回
CERT_NONE = "none"
CERT_PENDING = "pending"
CERT_APPROVED = "approved"
CERT_REJECTED = "rejected"

# 审核动作（教师端接口文档 §3：approve 置位能力位，reject 维持拒绝）
REVIEW_APPROVE = "approve"
REVIEW_REJECT = "reject"

# ---------- 领域异常（http_status 由 core/errors.py 统一映射） ----------


class UserNotFoundError(DomainError):
    """用户不存在。"""

    http_status = 404


class AccountExistsError(DomainError):
    """用户名或邮箱已被注册。"""

    http_status = 400


class WrongCredentialsError(DomainError):
    """账号或密码错误。"""

    http_status = 401


class UserBannedError(DomainError):
    """账号已被封禁，请联系管理员。"""

    http_status = 403


class AdminBanDeniedError(DomainError):
    """不能封禁管理员账号。"""

    http_status = 400


class AssistantCertDeniedError(DomainError):
    """仅学生角色可申请助教认证（能力位是学生角色的附加能力位）。"""

    http_status = 400


class AssistantCertStateError(DomainError):
    """助教认证状态不允许该操作（重复申请 / 重复审核 / 目标非研究生）。"""

    http_status = 400


# ---------- 不变量与规则 ----------


def ensure_not_banned(status: str) -> None:
    """不变量：被封禁账号不得登录或执行写互动。"""
    if status == STATUS_BANNED:
        raise UserBannedError()


def ensure_can_ban(role: str) -> None:
    """不变量：管理员账号不可被封禁。"""
    if role == ROLE_ADMIN:
        raise AdminBanDeniedError()


def is_graduate_assistant(role: str, identity_type: str, cert_status: str) -> bool:
    """助教能力位判定（US-20 / Q-07 / E-12）：学生角色 + 研究生身份 + 认证通过。

    三个条件缺一不可：教师/管理员即使研究生且认证通过也不放行（能力位
    仅附加于学生角色）；研究生未认证或被驳回不放行；本科生永不放行。
    """
    return (
        role == ROLE_STUDENT
        and identity_type == IDENTITY_POSTGRADUATE
        and cert_status == CERT_APPROVED
    )


def ensure_can_apply(role: str, cert_status: str) -> None:
    """不变量：仅学生可申请，且 pending/approved 状态不可重复申请（rejected 可重新申请）。"""
    if role != ROLE_STUDENT:
        raise AssistantCertDeniedError()
    if cert_status in (CERT_PENDING, CERT_APPROVED):
        raise AssistantCertStateError()


def ensure_can_review(identity_type: str, cert_status: str) -> None:
    """不变量：仅研究生身份且处于待审核状态可被审核（Q-07 / 教师端接口文档 §3）。"""
    if identity_type != IDENTITY_POSTGRADUATE:
        raise AssistantCertStateError()
    if cert_status != CERT_PENDING:
        raise AssistantCertStateError()
