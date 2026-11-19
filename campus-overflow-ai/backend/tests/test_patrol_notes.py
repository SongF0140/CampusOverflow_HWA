# 夜间离线整理（N-1/N-2）测试：反馈窗口只读、笔记幂等、批量上限与鉴权。
# 依据 docs/Agent层设计与实施分期.md「夜间静默治理」、C-06/C-07。
from datetime import datetime, timedelta

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.core.config import settings
from app.modules.governance.models import ModerationCase, PatrolNote

SERVICE_AUTH = {"X-Service-Token": settings.agent_service_token}


def _case(db: Session, **overrides) -> ModerationCase:
    values = {
        "target_type": "question",
        "target_id": 10,
        "risk_level": "high",
        "source": "agent",
        "reason": "疑似辱骂，建议人工复核",
        "snapshot": "question#10 body=疑似正文",
        "status": "rejected",
        "resolution": "skip",
        "decision_source": "manager_directed",
        "created_at": datetime(2026, 11, 10, 0, 0),
    }
    values.update(overrides)
    case = ModerationCase(**values)
    db.add(case)
    db.commit()
    db.refresh(case)
    return case


def _note(note_key: str, **overrides) -> dict:
    values = {
        "note_key": note_key,
        "note_type": "false_positive",
        "source_case_id": None,
        "target_type": "question",
        "target_id": 10,
        "rule_version": "patrol-n1-v1",
        "model_version": "deterministic",
        "summary": "巡检误报：case#1 question#10",
        "confidence": 90,
        "valid_until": (datetime(2026, 12, 10)).isoformat(),
    }
    values.update(overrides)
    return values


def test_feedback_window_excludes_content_and_private_fields(
    client: TestClient, db_session: Session
) -> None:
    """反馈只返回分析所需字段：不含快照、管理员自由文本与决策轨迹。"""
    _case(db_session)
    _case(
        db_session, target_id=11, source="admin", status="executed",
        resolution="hide", manager_feedback="管理员内部备注",
    )

    assert client.get("/internal/agent/patrol/feedback").status_code == 401
    resp = client.get("/internal/agent/patrol/feedback?days=14", headers=SERVICE_AUTH)
    assert resp.status_code == 200
    data = resp.json()["data"]
    assert data["total"] == 2
    item = data["items"][0]
    for forbidden in ("snapshot", "manager_feedback", "decision_trace", "reason_detail"):
        assert forbidden not in item
    assert item["reason"] == "疑似辱骂，建议人工复核"


def test_feedback_window_filters_old_cases(client: TestClient, db_session: Session) -> None:
    """超出窗口的工单不返回，避免旧规则污染当前整理。"""
    _case(db_session, created_at=datetime.now() - timedelta(days=30))
    _case(db_session, target_id=12, created_at=datetime.now() - timedelta(days=1))

    resp = client.get("/internal/agent/patrol/feedback?days=14", headers=SERVICE_AUTH)
    assert resp.status_code == 200
    assert resp.json()["data"]["total"] == 1


def test_patrol_notes_idempotent_and_bounded(
    client: TestClient, db_session: Session
) -> None:
    """同一 note_key 重复提交返回既有记录；单批超过 5 条拒绝。"""
    payload = {"notes": [_note("false_positive:1:patrol-n1-v1")]}
    first = client.post("/internal/agent/patrol/notes", headers=SERVICE_AUTH, json=payload)
    assert first.status_code == 200
    assert first.json()["data"]["repeated"] == 0
    assert db_session.query(PatrolNote).count() == 1

    second = client.post("/internal/agent/patrol/notes", headers=SERVICE_AUTH, json=payload)
    assert second.status_code == 200
    assert second.json()["data"]["repeated"] == 1
    assert second.json()["data"]["repeat"] is True
    assert db_session.query(PatrolNote).count() == 1

    too_many = {"notes": [_note(f"k{i}") for i in range(6)]}
    resp = client.post("/internal/agent/patrol/notes", headers=SERVICE_AUTH, json=too_many)
    assert resp.status_code == 400

    bad_type = {"notes": [_note("k-bad", note_type="auto_delete")]}
    resp = client.post("/internal/agent/patrol/notes", headers=SERVICE_AUTH, json=bad_type)
    assert resp.status_code == 400

    assert client.post(
        "/internal/agent/patrol/notes", json=payload,
    ).status_code == 401


def test_expire_patrol_notes_only_active(client: TestClient, db_session: Session) -> None:
    """过期降级只改已过期且 active 的笔记，重复调用幂等。"""
    payload = {"notes": [
        _note("expired-1", valid_until=datetime(2020, 1, 1).isoformat()),
        _note("active-1", valid_until=datetime(2099, 1, 1).isoformat()),
    ]}
    assert client.post(
        "/internal/agent/patrol/notes", headers=SERVICE_AUTH, json=payload,
    ).status_code == 200

    first = client.post("/internal/agent/patrol/notes/expire", headers=SERVICE_AUTH)
    assert first.status_code == 200
    assert first.json()["data"]["expired"] == 1
    statuses = {row.note_key: row.status for row in db_session.query(PatrolNote).all()}
    assert statuses == {"expired-1": "expired", "active-1": "active"}

    second = client.post("/internal/agent/patrol/notes/expire", headers=SERVICE_AUTH)
    assert second.json()["data"]["expired"] == 0
    assert client.post("/internal/agent/patrol/notes/expire").status_code == 401


def test_injected_notes_filter_active_confidence_and_budget(
    client: TestClient, db_session: Session
) -> None:
    """N-3 注入只读：排除过期与低置信度笔记，并遵守字符预算。"""
    long_summary = "规则可能失效：" + "同类内容" * 50
    payload = {"notes": [
        _note("inject-high", confidence=95, evidence_count=3,
              valid_until=datetime(2099, 1, 1).isoformat(), summary=long_summary),
        _note("inject-low", confidence=40, evidence_count=3,
              valid_until=datetime(2099, 1, 1).isoformat()),
        _note("inject-expired", confidence=99, evidence_count=3,
              valid_until=datetime(2020, 1, 1).isoformat()),
        _note("inject-single", confidence=99, evidence_count=1,
              valid_until=datetime(2099, 1, 1).isoformat()),
        _note("inject-gap", confidence=99, evidence_count=9, note_type="gap",
              valid_until=datetime(2099, 1, 1).isoformat()),
    ]}
    assert client.post(
        "/internal/agent/patrol/notes", headers=SERVICE_AUTH, json=payload,
    ).status_code == 200
    client.post("/internal/agent/patrol/notes/expire", headers=SERVICE_AUTH)

    default = client.get(
        "/internal/agent/patrol/notes/injected", headers=SERVICE_AUTH,
    ).json()["data"]
    assert [item["note_key"] for item in default["items"]] == ["inject-high"]

    widened = client.get(
        "/internal/agent/patrol/notes/injected?min_confidence=0", headers=SERVICE_AUTH,
    ).json()["data"]
    keys = {item["note_key"] for item in widened["items"]}
    assert keys == {"inject-high", "inject-low"}
    assert "inject-expired" not in keys
    assert "inject-single" not in keys
    assert "inject-gap" not in keys
    budgeted = client.get(
        "/internal/agent/patrol/notes/injected?min_confidence=0&max_chars=200",
        headers=SERVICE_AUTH,
    ).json()["data"]
    assert budgeted["truncated"] is True
    assert budgeted["total"] == 0

    assert client.get("/internal/agent/patrol/notes/injected").status_code == 401


def test_retract_note_removes_from_injection(client: TestClient, db_session: Session) -> None:
    """撤回后立即从注入候选移除；重复撤回幂等；不存在返回 404。"""
    payload = {"notes": [_note(
        "retract-1", confidence=99, evidence_count=3,
        valid_until=datetime(2099, 1, 1).isoformat(),
    )]}
    created = client.post(
        "/internal/agent/patrol/notes", headers=SERVICE_AUTH, json=payload,
    ).json()["data"]["items"][0]
    assert client.get(
        "/internal/agent/patrol/notes/injected", headers=SERVICE_AUTH,
    ).json()["data"]["total"] == 1

    resp = client.post(
        f"/internal/agent/patrol/notes/{created['id']}/retract", headers=SERVICE_AUTH,
    )
    assert resp.status_code == 200
    assert resp.json()["data"]["status"] == "retracted"
    assert client.get(
        "/internal/agent/patrol/notes/injected", headers=SERVICE_AUTH,
    ).json()["data"]["total"] == 0

    again = client.post(
        f"/internal/agent/patrol/notes/{created['id']}/retract", headers=SERVICE_AUTH,
    )
    assert again.status_code == 200
    assert again.json()["data"]["status"] == "retracted"

    assert client.post(
        "/internal/agent/patrol/notes/999999/retract", headers=SERVICE_AUTH,
    ).status_code == 404
    assert client.post(
        f"/internal/agent/patrol/notes/{created['id']}/retract",
    ).status_code == 401
