# T-16-A 管理端观测接口测试（US-18/C-08）：运行列表筛选分页、单运行 trace 聚合
# （运行+事件+工具调用+关联工单）、失败运行可定位、非管理员 403。

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.security import create_access_token
from app.modules.governance.models import AgentRun, AgentRunEvent, ModerationCase, ToolCallLog
from app.modules.identity.models import User

SERVICE_AUTH = {"X-Service-Token": settings.agent_service_token}


def _auth(user: User) -> dict:
    return {"Authorization": f"Bearer {create_access_token(user.id, user.role)}"}


def _create_user(db: Session, username: str, role: str = "student") -> User:
    user = User(
        username=username, email=f"{username}@example.com",
        password_hash="unused", role=role,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def _seed_full_run(db: Session, trace_id: str, run_id: str, status: str = "succeeded",
                   user_id: int | None = None) -> None:
    """种子一条完整调用链：运行 + 事件 + 工具调用（+ 可选关联工单）。"""
    db.add(AgentRun(
        task_type="chat", trace_id=trace_id, agent_run_id=run_id,
        input_summary="知识问答", status=status, user_id=user_id,
        error_summary="任务未完成" if status == "failed" else None,
    ))
    db.add(AgentRunEvent(
        agent_run_id=run_id, sequence_no=1, event_type="plan",
        plan_revision=1, steps=[{"step_id": "s1", "tool_name": "fetchTags"}],
        trace_id=trace_id,
    ))
    db.add(ToolCallLog(
        agent_run_id=run_id, tool_name="fetchTags", status="succeeded",
        args_summary="limit=100", result_summary="5 个标签",
        duration_ms=120, trace_id=trace_id,
    ))
    db.commit()


def test_run_list_filters_and_permission(
    client: TestClient, db_session: Session
) -> None:
    """列表按状态/任务类型/用户筛选分页；仅管理员；非法筛选 400。"""
    admin = _create_user(db_session, "obs_admin", "admin")
    student = _create_user(db_session, "obs_stu", "student")
    _seed_full_run(db_session, "trace-a", "run-a", status="succeeded", user_id=student.id)
    _seed_full_run(db_session, "trace-b", "run-b", status="failed")

    url = "/api/governance/agent-runs"
    assert client.get(url).status_code == 401
    assert client.get(url, headers=_auth(student)).status_code == 403

    resp = client.get(url, headers=_auth(admin))
    assert resp.status_code == 200
    assert resp.json()["data"]["total"] == 2

    resp = client.get(
        f"{url}?status=failed", headers=_auth(admin)
    )
    items = resp.json()["data"]["items"]
    assert len(items) == 1
    assert items[0]["agent_run_id"] == "run-b"
    # 失败原因可见（US-18 完成判定）
    assert items[0]["error_summary"] == "任务未完成"

    resp = client.get(
        f"{url}?task_type=chat&user_id={student.id}", headers=_auth(admin)
    )
    assert resp.json()["data"]["total"] == 1

    assert (
        client.get(f"{url}?status=invalid", headers=_auth(admin)).status_code == 400
    )


def test_run_trace_aggregates_full_chain(
    client: TestClient, db_session: Session
) -> None:
    """单运行详情聚合运行/事件/工具调用/同 trace 工单（完成判定：完整调用链）。"""
    admin = _create_user(db_session, "obs_admin2", "admin")
    _seed_full_run(db_session, "trace-c", "run-c")
    db_session.add(ModerationCase(
        target_type="question", target_id=1, risk_level="high", source="agent",
        reason="巡检发现", snapshot="{}", status="pending", trace_id="trace-c",
    ))
    db_session.commit()

    resp = client.get("/api/governance/agent-runs/run-c", headers=_auth(admin))
    assert resp.status_code == 200
    data = resp.json()["data"]
    assert data["run"]["agent_run_id"] == "run-c"
    assert data["run"]["trace_id"] == "trace-c"
    assert len(data["events"]) == 1
    assert data["events"][0]["event_type"] == "plan"
    assert len(data["tool_calls"]) == 1
    assert data["tool_calls"][0]["tool_name"] == "fetchTags"
    # 同 trace 工单被关联（运行 → 工单溯源）
    assert len(data["related_cases"]) == 1
    assert data["related_cases"][0]["trace_id"] == "trace-c"

    # 不存在的运行 404
    assert (
        client.get(
            "/api/governance/agent-runs/run-missing", headers=_auth(admin)
        ).status_code
        == 404
    )
