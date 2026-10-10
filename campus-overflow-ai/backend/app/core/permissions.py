# 权限依赖：当前用户解析、角色校验、能力位（三端差异全部收敛在本文件）
# 例外说明：架构规则"core 不得 import modules"的唯一豁免点——
# get_current_user 内部读取 identity 的 User ORM 完成鉴权，
# 对外只输出轻量 UserPrincipal，ORM 细节不泄漏到任何 router。
from dataclasses import dataclass
from typing import Annotated

from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session

from app.core.security import decode_access_token
from app.db.session import get_db
from app.modules.identity.domain import is_graduate_assistant
from app.modules.identity.models import User

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login", auto_error=False)


@dataclass(frozen=True)
class UserPrincipal:
    """当前登录用户的轻量身份（不含 ORM 与隐私字段），router 层唯一接触的用户形态。"""

    id: int
    role: str
    status: str
    # 助教能力位字段（T-02a）：判定规则在 identity/domain.is_graduate_assistant
    identity_type: str = "undergraduate"
    assistant_cert_status: str = "none"


def get_current_user(
    token: str | None = Depends(oauth2_scheme),
    db: Session = Depends(get_db),
) -> UserPrincipal:
    """从 Authorization Bearer Token 解析当前登录用户；未登录或 token 无效返回 401。"""
    if not token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="未登录或登录已过期")
    payload = decode_access_token(token)
    if not payload or "sub" not in payload:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="登录凭证无效")
    try:
        # sub 非数字的合法签名 token（伪造或历史错误签发）按无效凭证处理，不 500
        user = db.get(User, int(payload["sub"]))
    except (TypeError, ValueError):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="登录凭证无效")
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="用户不存在")
    if user.status == "banned":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="账号已被封禁")
    return UserPrincipal(
        id=user.id,
        role=user.role,
        status=user.status,
        identity_type=user.identity_type,
        assistant_cert_status=user.assistant_cert_status,
    )


# 常用类型别名：路由中以 current_user: CurrentUser 注入当前用户
CurrentUser = Annotated[UserPrincipal, Depends(get_current_user)]


def require_roles(*roles: str):
    """角色校验依赖工厂：当前用户角色不在允许列表中时返回 403。"""

    def checker(current_user: UserPrincipal = Depends(get_current_user)) -> UserPrincipal:
        if current_user.role not in roles:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="权限不足")
        return current_user

    return checker


def require_graduate_assistant(
    current_user: UserPrincipal = Depends(get_current_user),
) -> UserPrincipal:
    """助教能力位（US-20 / Q-07 / E-12）：学生角色 + 研究生身份 + 认证通过才放行。

    本科生、未认证或被驳回的研究生访问助教板块接口一律 403；
    前端不出现入口由第二阶段前端依据 me 接口的身份字段保证。
    """
    if not is_graduate_assistant(
        current_user.role, current_user.identity_type, current_user.assistant_cert_status
    ):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="需要研究生助教权限"
        )
    return current_user
