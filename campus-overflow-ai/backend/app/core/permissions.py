# 权限依赖：当前用户解析、角色校验、能力位（三端差异全部收敛在本文件）
# 例外说明：架构规则"core 不得 import modules"的唯一豁免点——
# get_current_user 的返回值就是 identity 的 User ORM 模型（本项目 ORM 即领域模型）。
from typing import Annotated

from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session

from app.core.security import decode_access_token
from app.db.session import get_db
from app.modules.identity.models import User

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login", auto_error=False)


def get_current_user(
    token: str | None = Depends(oauth2_scheme),
    db: Session = Depends(get_db),
) -> User:
    """从 Authorization Bearer Token 解析当前登录用户；未登录或 token 无效返回 401。"""
    if not token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="未登录或登录已过期")
    payload = decode_access_token(token)
    if not payload or "sub" not in payload:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="登录凭证无效")
    user = db.get(User, int(payload["sub"]))
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="用户不存在")
    if user.status == "banned":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="账号已被封禁")
    return user


# 常用类型别名：路由中以 current_user: CurrentUser 注入当前用户
CurrentUser = Annotated[User, Depends(get_current_user)]


def require_roles(*roles: str):
    """角色校验依赖工厂：当前用户角色不在允许列表中时返回 403。"""

    def checker(current_user: User = Depends(get_current_user)) -> User:
        if current_user.role not in roles:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="权限不足")
        return current_user

    return checker
