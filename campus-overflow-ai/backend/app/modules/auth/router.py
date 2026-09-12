# 认证路由：注册、登录
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.dependencies import get_db
from app.modules.users.schemas import UserLoginRequest, UserRegisterRequest
from app.modules.users.service import UserService
from app.shared.response import ok

router = APIRouter(prefix="/api/auth", tags=["认证"])


@router.post("/register")
def register(req: UserRegisterRequest, db: Session = Depends(get_db)) -> dict:
    """用户注册：学生角色默认注册。"""
    service = UserService(db)
    user = service.register(req)
    return ok(user.model_dump(), "注册成功")


@router.post("/login")
def login(req: UserLoginRequest, db: Session = Depends(get_db)) -> dict:
    """用户登录：支持用户名或邮箱，返回 JWT token。"""
    service = UserService(db)
    result = service.login(req.account, req.password)
    return ok(result.model_dump(), "登录成功")
