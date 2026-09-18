# SQLAlchemy 声明基类：所有 ORM 模型继承此类
from sqlalchemy.orm import DeclarativeBase


class Base(DeclarativeBase):
    """所有业务模型的基类，Alembic 迁移通过 Base.metadata 自动发现表。"""
    pass
