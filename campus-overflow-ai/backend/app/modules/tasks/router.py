# 任务路由：创建、查询、完成任务
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.core.dependencies import get_db
from app.modules.tasks.schemas import TaskCreateRequest, TaskResponse
from app.modules.tasks.service import TaskService
from app.shared.response import ok

router = APIRouter(prefix="/api/tasks", tags=["任务"])


@router.post("")
def create_task(req: TaskCreateRequest, db: Session = Depends(get_db)) -> dict:
    """创建任务，初始状态为待完成。"""
    service = TaskService(db)
    task = service.create(req)
    return ok(task.model_dump(), "任务创建成功")


@router.get("")
def list_tasks(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
) -> dict:
    """分页查询任务列表。"""
    service = TaskService(db)
    tasks, total = service.list_tasks(page, page_size)
    data = {
        "items": [TaskResponse.model_validate(t).model_dump() for t in tasks],
        "total": total,
        "page": page,
        "page_size": page_size,
    }
    return ok(data)


@router.get("/{task_id}")
def get_task(task_id: int, db: Session = Depends(get_db)) -> dict:
    """按编号查看任务详情。"""
    service = TaskService(db)
    task = service.get(task_id)
    return ok(task.model_dump())


@router.post("/{task_id}/complete")
def complete_task(task_id: int, db: Session = Depends(get_db)) -> dict:
    """按编号完成任务：任务不存在返回404，重复完成返回400。"""
    service = TaskService(db)
    task = service.complete(task_id)
    return ok(task.model_dump(), "任务完成成功")
