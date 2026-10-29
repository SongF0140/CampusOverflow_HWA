"""专属外部凭证映射；只返回后端当前身份，不签发人类登录令牌。"""
import hashlib
import json
import secrets

from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.permissions import UserPrincipal
from app.modules.governance import domain
from app.modules.identity import service as identity_service
from app.modules.identity.domain import UserNotFoundError


def resolve_external_admin(db: Session, key: str | None) -> UserPrincipal | None:
    if not key:
        return None
    digest = hashlib.sha256(key.encode()).hexdigest()
    try:
        mappings = json.loads(settings.external_agent_keys)
        if not isinstance(mappings, list):
            return None
        hashes = set()
        for item in mappings:
            if (not isinstance(item, dict) or set(item) != {"key_hash", "user_id", "enabled"}
                    or not isinstance(item.get("key_hash"), str)
                    or len(item["key_hash"]) != 64
                    or any(ch not in "0123456789abcdef" for ch in item["key_hash"])
                    or type(item.get("user_id")) is not int or item["user_id"] <= 0
                    or type(item.get("enabled")) is not bool or item["key_hash"] in hashes):
                return None
            hashes.add(item["key_hash"])
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
