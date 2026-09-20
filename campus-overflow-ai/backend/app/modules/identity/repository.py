# identity 数据访问：查询与写入函数，仅被本模块 service 调用（架构规则 2.3-3）
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.modules.identity.models import User


def find_by_account(db: Session, account: str) -> User | None:
    """按用户名或邮箱查找用户。"""
    return db.query(User).filter(
        or_(User.username == account, User.email == account)
    ).first()


def username_or_email_exists(db: Session, username: str, email: str) -> bool:
    """注册前校验用户名 / 邮箱是否已被占用。"""
    return db.query(User).filter(
        or_(User.username == username, User.email == email)
    ).first() is not None


def get_by_id(db: Session, user_id: int) -> User | None:
    """按主键查询用户，不存在返回 None。"""
    return db.get(User, user_id)


def save(db: Session, user: User) -> User:
    """写入并刷新用户。"""
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def list_users(db: Session, page: int = 1, page_size: int = 20) -> tuple[list[User], int]:
    """分页查看用户列表，按 id 升序。"""
    offset = (page - 1) * page_size
    query = db.query(User)
    total = query.count()
    users = query.order_by(User.id.asc()).offset(offset).limit(page_size).all()
    return users, total
