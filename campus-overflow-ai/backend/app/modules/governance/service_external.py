"""专属外部凭证映射；只返回后端当前身份，不签发人类登录令牌。"""
import hashlib
import secrets

from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.permissions import UserPrincipal
from app.modules.governance import domain
from app.modules.identity import service as identity_service
from app.modules.identity.domain import UserNotFoundError


def configured_external_admins() -> list[dict] | None:
    """统一校验映射；审批时只有指纹，也必须拒绝损坏或重复配置。"""
    return domain.parse_external_admin_mappings(settings.external_agent_keys)


def resolve_external_admin(db: Session, key: str | None) -> UserPrincipal | None:
    if not key:
        return None
    digest = hashlib.sha256(key.encode()).hexdigest()
    mappings = configured_external_admins()
    if mappings is None:
        return None
    try:
        for item in mappings:
            if not item["enabled"] or not secrets.compare_digest(digest, item["key_hash"]):
                continue
            user_id = item.get("user_id")
            if type(user_id) is not int or user_id <= 0:
                return None
            user = identity_service.get_by_id(db, user_id)
            if user.role != "admin" or user.status != "active":
                raise domain.CaseActionForbiddenError("关联管理员当前不可用")
            return UserPrincipal(user.id, user.role, user.status,
                                 user.identity_type, user.assistant_cert_status)
    except (ValueError, TypeError, UserNotFoundError):
        return None
    return None
