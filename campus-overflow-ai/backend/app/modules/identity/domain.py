# identity 领域规则：账号状态机、不变量与领域异常
# 铁律：零框架依赖——本文件不得 import fastapi / sqlalchemy / pydantic，可直接单测。
from app.core.domain_error import DomainError

# ---------- 领域常量 ----------

ROLE_STUDENT = "student"
ROLE_TEACHER = "teacher"
ROLE_ADMIN = "admin"

STATUS_ACTIVE = "active"
STATUS_BANNED = "banned"

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


# ---------- 不变量与规则 ----------


def ensure_not_banned(status: str) -> None:
    """不变量：被封禁账号不得登录或执行写互动。"""
    if status == STATUS_BANNED:
        raise UserBannedError()


def ensure_can_ban(role: str) -> None:
    """不变量：管理员账号不可被封禁。"""
    if role == ROLE_ADMIN:
        raise AdminBanDeniedError()
