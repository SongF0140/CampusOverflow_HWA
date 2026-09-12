# 任务模块 Pydantic Schema：请求入参与响应出参
from datetime import datetime

from pydantic import BaseModel, Field


# ---------- 请求 Schema ----------

class TaskCreateRequest(BaseModel):
    """创建任务请求。"""
    title: str = Field(..., min_length=1, max_length=200, description="任务标题")
    description: str | None = Field(None, description="任务描述")


# ---------- 响应 Schema ----------

class TaskResponse(BaseModel):
    """任务信息响应。"""
    id: int
    title: str
    description: str | None = None
    status: str
    created_at: datetime
    completed_at: datetime | None = None

    model_config = {"from_attributes": True}
