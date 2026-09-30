# identity 数据访问：查询与写入函数，仅被本模块 service 调用（架构规则 2.3-3）
# 分层基线 D-2：本文件是模块内唯一允许 import models 的地方；出参一律 schemas。
# 事务约定 D-8：本层只 flush 不 commit，事务边界（commit）在 service 用例层。
from datetime import datetime

from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.modules.identity import domain
from app.modules.identity.models import User
from app.modules.identity.schemas import (
    AssistantCertItemResponse,
    UserAuthInternal,
    UserResponse,
)


def _to_response(user: User) -> UserResponse:
    return UserResponse.model_validate(user)


def find_auth_by_account(db: Session, account: str) -> UserAuthInternal | None:
    """按用户名或邮箱查找用户（含密码哈希，供登录校验）。"""
    user = db.query(User).filter(
        or_(User.username == account, User.email == account)
    ).first()
    return UserAuthInternal.model_validate(user) if user else None


def username_or_email_exists(db: Session, username: str, email: str) -> bool:
    """注册前校验用户名 / 邮箱是否已被占用。"""
    return db.query(User).filter(
        or_(User.username == username, User.email == email)
    ).first() is not None


def get_by_id(db: Session, user_id: int) -> UserResponse | None:
    """按主键查询用户，不存在返回 None。"""
    user = db.get(User, user_id)
    return _to_response(user) if user else None


def get_usernames_by_ids(db: Session, user_ids: list[int]) -> dict[int, str]:
    """批量取用户名映射（跨模块公开函数的底层：courses 列表展示教师名等）。"""
    if not user_ids:
        return {}
    rows = db.query(User.id, User.username).filter(User.id.in_(user_ids)).all()
    return {user_id: username for user_id, username in rows}


def create_user(
    db: Session, username: str, email: str, password_hash: str,
    role: str = domain.ROLE_STUDENT, status: str = domain.STATUS_ACTIVE,
) -> UserResponse:
    """新建用户并入库。"""
    user = User(
        username=username,
        email=email,
        password_hash=password_hash,
        role=role,
        status=status,
    )
    db.add(user)
    db.flush()  # flush 拿到自增 id；提交由 service 用例层决定（D-8）
    return _to_response(user)


def update_profile(
    db: Session, user_id: int, bio: str | None, avatar_url: str | None,
) -> UserResponse:
    """更新个人资料字段（None 表示不修改）。"""
    user = db.get(User, user_id)
    if user is None:
        raise domain.UserNotFoundError()
    if bio is not None:
        user.bio = bio
    if avatar_url is not None:
        user.avatar_url = avatar_url
    db.flush()
    return _to_response(user)


def set_banned(db: Session, user_id: int, reason: str | None) -> UserResponse:
    """状态迁移：active → banned，记录封禁原因。"""
    user = db.get(User, user_id)
    if user is None:
        raise domain.UserNotFoundError()
    user.status = domain.STATUS_BANNED
    user.ban_reason = reason
    db.flush()
    return _to_response(user)


def set_active(db: Session, user_id: int) -> UserResponse:
    """状态迁移：banned → active，清空封禁原因。"""
    user = db.get(User, user_id)
    if user is None:
        raise domain.UserNotFoundError()
    user.status = domain.STATUS_ACTIVE
    user.ban_reason = None
    db.flush()
    return _to_response(user)


def list_users(db: Session, page: int = 1, page_size: int = 20) -> tuple[list[UserResponse], int]:
    """分页查看用户列表，按 id 升序。"""
    offset = (page - 1) * page_size
    query = db.query(User)
    total = query.count()
    users = query.order_by(User.id.asc()).offset(offset).limit(page_size).all()
    return [_to_response(u) for u in users], total


def apply_assistant_certification(db: Session, user_id: int) -> UserResponse:
    """申请助教认证：声明研究生身份并置为待审核（申请即声明，教师审核把关）。"""
    user = db.get(User, user_id)
    if user is None:
        raise domain.UserNotFoundError()
    user.identity_type = domain.IDENTITY_POSTGRADUATE
    user.assistant_cert_status = domain.CERT_PENDING
    user.assistant_cert_applied_at = datetime.now()
    db.flush()
    return _to_response(user)


def review_assistant_certification(
    db: Session, user_id: int, cert_status: str, reviewer_id: int
) -> UserResponse:
    """审核助教认证：approve/reject 落状态并留操作者与时间。"""
    user = db.get(User, user_id)
    if user is None:
        raise domain.UserNotFoundError()
    user.assistant_cert_status = cert_status
    user.assistant_cert_reviewed_by = reviewer_id
    user.assistant_cert_reviewed_at = datetime.now()
    db.flush()
    return _to_response(user)


def list_assistant_certifications(
    db: Session, cert_status: str, page: int, page_size: int
) -> tuple[list[AssistantCertItemResponse], int]:
    """按认证状态分页列出研究生申请（不含证件等隐私原文）。"""
    offset = (page - 1) * page_size
    query = db.query(User).filter(
        User.identity_type == domain.IDENTITY_POSTGRADUATE,
        User.assistant_cert_status == cert_status,
    )
    total = query.count()
    users = (
        query.order_by(User.assistant_cert_applied_at.desc())
        .offset(offset)
        .limit(page_size)
        .all()
    )
    return [
        AssistantCertItemResponse(
            user_id=u.id,
            username=u.username,
            certification_status=u.assistant_cert_status,
            applied_at=u.assistant_cert_applied_at,
        )
        for u in users
    ], total
