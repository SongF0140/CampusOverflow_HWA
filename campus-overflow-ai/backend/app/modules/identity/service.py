# identity 业务层：用例编排、事务边界与授权决策
# 分层基线 D-1/D-2/D-3：规则在 domain.py，ORM 留在 repository，本层不碰 HTTP 协议。
# 签名约定 D-7：入参只收基本类型（请求 schema 的拆字段留在 router），出参为响应 schema。
# 事务约定 D-8：写用例末尾显式 db.commit()，repository 只 flush 不提交。
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.logging import action_logger
from app.core.security import create_access_token, hash_password, verify_password
from app.modules.identity import domain, repository
from app.modules.identity.schemas import (
    AssistantCertItemResponse,
    LoginResponse,
    ReputationRankItemInternal,
    UserPublicResponse,
    UserResponse,
)


def register(db: Session, username: str, email: str, password: str) -> UserResponse:
    """用户注册：校验用户名/邮箱唯一，哈希密码后入库，默认学生角色。"""
    if repository.username_or_email_exists(db, username, email):
        raise domain.AccountExistsError()
    user = repository.create_user(
        db,
        username=username,
        email=email,
        password_hash=hash_password(password),
    )
    db.commit()
    return user


def login(db: Session, account: str, password: str) -> LoginResponse:
    """登录：支持用户名或邮箱，校验密码后签发 JWT；封禁账号拒绝登录。"""
    user = repository.find_auth_by_account(db, account)
    if not user or not verify_password(password, user.password_hash):
        raise domain.WrongCredentialsError()
    domain.ensure_not_banned(user.status)
    token = create_access_token(user.id, user.role)
    return LoginResponse(access_token=token, user=UserResponse.model_validate(user))


def get_by_id(db: Session, user_id: int) -> UserResponse:
    """按 ID 查询用户，不存在抛 UserNotFoundError。"""
    user = repository.get_by_id(db, user_id)
    if not user:
        raise domain.UserNotFoundError()
    return user


def get_me(db: Session, user_id: int) -> UserResponse:
    """获取当前登录用户完整信息（含邮箱）。"""
    return get_by_id(db, user_id)


def get_public(db: Session, user_id: int) -> UserPublicResponse:
    """获取用户公开信息（不含邮箱）。"""
    return UserPublicResponse.model_validate(get_by_id(db, user_id))


def get_usernames_by_ids(db: Session, user_ids: list[int]) -> dict[int, str]:
    """跨模块公开函数（分层基线 D-5）：批量取 id→用户名映射，供 courses 等展示。"""
    return repository.get_usernames_by_ids(db, user_ids)


def adjust_user_reputation(db: Session, user_id: int, delta: int) -> None:
    """内部积分协作函数：共用调用方 Session，由外层用例提交（D-8）。"""
    repository.adjust_user_reputation(db, user_id, delta)


def list_reputation_rank(db: Session, limit: int) -> list[ReputationRankItemInternal]:
    """跨模块累计总分榜查询，不暴露用户 ORM。"""
    return repository.list_reputation_rank(db, limit)


def update_profile(
    db: Session, user_id: int, bio: str | None, avatar_url: str | None,
    username: str | None = None, *, submitted_fields: set[str],
) -> UserResponse:
    """更新本人资料，昵称沿用账号唯一性规则。"""
    try:
        current = get_by_id(db, user_id)
        if username is not None and repository.username_or_email_exists(
            db, username, current.email, user_id,
        ):
            raise domain.AccountExistsError()
        user = repository.update_profile(
            db, user_id, bio, avatar_url, username, submitted_fields=submitted_fields,
        )
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise domain.AccountExistsError() from exc
    except Exception:
        db.rollback()
        raise
    return user


def ban_user(
    db: Session, user_id: int, reason: str | None, actor_id: int,
) -> UserResponse:
    """封禁状态与持久审计原子提交，操作者来自接口鉴权上下文。"""
    try:
        previous = repository.get_for_status_update(db, user_id)
        domain.ensure_can_ban(previous.role)
        banned = repository.set_banned(db, user_id, reason)
        repository.append_status_audit(db, actor_id, "ban", previous, banned)
        db.commit()
    except Exception:
        db.rollback()
        raise
    return banned


def unban_user(db: Session, user_id: int, actor_id: int) -> UserResponse:
    """当前原因清空但历史保留；重复解禁仍成功并留痕。"""
    try:
        previous = repository.get_for_status_update(db, user_id)
        user = repository.set_active(db, user_id)
        repository.append_status_audit(db, actor_id, "unban", previous, user)
        db.commit()
    except Exception:
        db.rollback()
        raise
    return user


def list_users(
    db: Session, page: int = 1, page_size: int = 20,
    keyword: str | None = None, role: str | None = None, status: str | None = None,
) -> tuple[list[UserResponse], int]:
    """管理员分页查看用户列表（返回完整信息），keyword/role/status 服务端筛选。"""
    return repository.list_users(db, page, page_size, keyword, role, status)


def apply_assistant_certification(db: Session, user_id: int) -> UserResponse:
    """申请助教认证：学生声明研究生身份进入待审核（US-20 / Q-07）。"""
    user = get_by_id(db, user_id)
    domain.ensure_can_apply(user.role, user.assistant_cert_status)
    applied = repository.apply_assistant_certification(db, user_id)
    db.commit()
    return applied


def review_assistant_certification(
    db: Session, reviewer_id: int, target_user_id: int, action: str, comment: str | None
) -> UserResponse:
    """教师审核助教认证：approve 置位能力位，reject 维持拒绝（教师端接口文档 §3）。"""
    target = get_by_id(db, target_user_id)
    domain.ensure_can_review(target.identity_type, target.assistant_cert_status)
    cert_status = (
        domain.CERT_APPROVED if action == domain.REVIEW_APPROVE else domain.CERT_REJECTED
    )
    reviewed = repository.review_assistant_certification(
        db, target_user_id, cert_status, reviewer_id
    )
    db.commit()
    # 审计留痕：操作者 / 时间 / 对象 / 结果（comment 仅入日志不落库）
    action_logger.info(
        "assistant_cert_review reviewer=%s target=%s action=%s comment=%s",
        reviewer_id, target_user_id, cert_status, comment,
    )
    return reviewed


def list_assistant_certifications(
    db: Session, cert_status: str, page: int, page_size: int
) -> tuple[list[AssistantCertItemResponse], int]:
    """教师按认证状态分页查看助教认证申请列表。"""
    return repository.list_assistant_certifications(db, cert_status, page, page_size)
