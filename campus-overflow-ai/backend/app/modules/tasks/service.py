# 任务服务：创建、查询、完成任务，含重复完成校验
from datetime import datetime, timezone

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.modules.tasks.models import Task
from app.modules.tasks.schemas import TaskCreateRequest, TaskResponse


class TaskService:
    """任务业务逻辑层：完成任务的状态流转与异常校验。"""

    def __init__(self, db: Session):
        self.db = db

    def create(self, req: TaskCreateRequest) -> TaskResponse:
        """创建任务，初始状态为 pending。"""
        task = Task(
            title=req.title,
            description=req.description,
            status="pending",
        )
        self.db.add(task)
        self.db.commit()
        self.db.refresh(task)
        return TaskResponse.model_validate(task)

    def get_by_id(self, task_id: int) -> Task:
        """按编号查询任务，不存在返回 404。"""
        task = self.db.get(Task, task_id)
        if not task:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"任务编号 {task_id} 不存在",
            )
        return task

    def get(self, task_id: int) -> TaskResponse:
        """获取任务详情。"""
        task = self.get_by_id(task_id)
        return TaskResponse.model_validate(task)

    def list_tasks(self, page: int = 1, page_size: int = 20) -> tuple[list[Task], int]:
        """分页查询任务列表。"""
        offset = (page - 1) * page_size
        query = self.db.query(Task)
        total = query.count()
        tasks = query.order_by(Task.id.asc()).offset(offset).limit(page_size).all()
        return tasks, total

    def complete(self, task_id: int) -> TaskResponse:
        """按编号完成任务：任务不存在返回404，重复完成返回400。"""
        task = self.get_by_id(task_id)
        if task.status == "completed":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"任务 {task_id} 已完成，不能重复完成",
            )
        task.status = "completed"
        task.completed_at = datetime.now(timezone.utc)
        self.db.commit()
        self.db.refresh(task)
        return TaskResponse.model_validate(task)
