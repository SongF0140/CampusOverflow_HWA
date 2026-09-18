# 任务模块测试：创建、查询、完成任务及异常场景
from fastapi.testclient import TestClient


def _create_task(client: TestClient, title: str = "测试任务") -> int:
    """测试辅助：创建一个任务并返回ID。"""
    resp = client.post("/api/tasks", json={"title": title, "description": "测试描述"})
    return resp.json()["data"]["id"]


def test_create_task_success(client: TestClient) -> None:
    """正常创建任务应返回200和任务信息。"""
    resp = client.post("/api/tasks", json={
        "title": "完成作业",
        "description": "提交数学作业",
    })
    assert resp.status_code == 200
    body = resp.json()
    assert body["code"] == 200
    assert body["data"]["title"] == "完成作业"
    assert body["data"]["status"] == "pending"
    assert body["data"]["completed_at"] is None


def test_create_task_empty_title(client: TestClient) -> None:
    """标题为空应返回422（Pydantic校验）。"""
    resp = client.post("/api/tasks", json={"title": ""})
    assert resp.status_code == 422


def test_list_tasks(client: TestClient) -> None:
    """查询任务列表应返回分页数据。"""
    _create_task(client, "任务1")
    _create_task(client, "任务2")
    resp = client.get("/api/tasks")
    assert resp.status_code == 200
    data = resp.json()["data"]
    assert data["total"] == 2
    assert len(data["items"]) == 2


def test_get_task_success(client: TestClient) -> None:
    """按编号查询存在的任务应返回200。"""
    task_id = _create_task(client, "查询测试")
    resp = client.get(f"/api/tasks/{task_id}")
    assert resp.status_code == 200
    assert resp.json()["data"]["title"] == "查询测试"


def test_get_task_not_found(client: TestClient) -> None:
    """查询不存在的任务编号应返回404。"""
    resp = client.get("/api/tasks/99999")
    assert resp.status_code == 404
    assert "不存在" in resp.json()["detail"]


def test_complete_task_success(client: TestClient) -> None:
    """正常完成任务应返回200，状态变为completed。"""
    task_id = _create_task(client, "待完成任务")
    resp = client.post(f"/api/tasks/{task_id}/complete")
    assert resp.status_code == 200
    data = resp.json()["data"]
    assert data["status"] == "completed"
    assert data["completed_at"] is not None


def test_complete_task_not_found(client: TestClient) -> None:
    """完成不存在的任务编号应返回404。"""
    resp = client.post("/api/tasks/99999/complete")
    assert resp.status_code == 404
    assert "不存在" in resp.json()["detail"]


def test_complete_task_duplicate(client: TestClient) -> None:
    """重复完成同一任务应返回400。"""
    task_id = _create_task(client, "重复完成测试")
    # 第一次完成
    first = client.post(f"/api/tasks/{task_id}/complete")
    assert first.status_code == 200
    assert first.json()["data"]["status"] == "completed"
    # 第二次完成应报错
    second = client.post(f"/api/tasks/{task_id}/complete")
    assert second.status_code == 400
    assert "已完成" in second.json()["detail"]
    assert "不能重复完成" in second.json()["detail"]


def test_completed_task_status_persists(client: TestClient) -> None:
    """完成任务后再次查询，状态应保持completed。"""
    task_id = _create_task(client, "状态持久化测试")
    client.post(f"/api/tasks/{task_id}/complete")
    resp = client.get(f"/api/tasks/{task_id}")
    assert resp.json()["data"]["status"] == "completed"
    assert resp.json()["data"]["completed_at"] is not None
