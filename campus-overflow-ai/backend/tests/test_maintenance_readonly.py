# 维护读模式（S2）测试：窗口纯函数与写请求拦截
from datetime import datetime, time, timedelta

import pytest
from fastapi.testclient import TestClient

from app.core.config import settings
from app.core.maintenance import MAINTENANCE_TZ, is_read_only_window, parse_hhmm

SHANGHAI_TZ = MAINTENANCE_TZ


def _at(hour: int, minute: int = 0) -> datetime:
    return datetime(2026, 11, 18, hour, minute, tzinfo=SHANGHAI_TZ)


def test_parse_hhmm_valid() -> None:
    assert parse_hhmm("01:00") == time(1, 0)
    assert parse_hhmm(" 23:59 ") == time(23, 59)


@pytest.mark.parametrize("value", ["", "24:00", "01:60", "1", "aa:bb", "1:2:3", "-1:00", None])
def test_parse_hhmm_invalid_returns_none(value: str | None) -> None:
    assert parse_hhmm(value) is None  # type: ignore[arg-type]


def test_window_inside_same_day() -> None:
    assert is_read_only_window(_at(2, 0), "01:00", "05:00") is True


def test_window_outside_same_day() -> None:
    assert is_read_only_window(_at(0, 30), "01:00", "05:00") is False
    assert is_read_only_window(_at(5, 0), "01:00", "05:00") is False


def test_window_cross_midnight() -> None:
    assert is_read_only_window(_at(23, 30), "23:00", "02:00") is True
    assert is_read_only_window(_at(0, 30), "23:00", "02:00") is True
    assert is_read_only_window(_at(1, 59), "23:00", "02:00") is True
    assert is_read_only_window(_at(2, 0), "23:00", "02:00") is False
    assert is_read_only_window(_at(12, 0), "23:00", "02:00") is False


@pytest.mark.parametrize(
    ("start", "end"),
    [("25:00", "05:00"), ("01:00", "5:00x"), ("", ""), ("01:00", "01:00")],
)
def test_window_invalid_config_falls_back_to_closed(start: str, end: str) -> None:
    assert is_read_only_window(_at(2, 0), start, end) is False


def _enable_window_covering_now(monkeypatch: pytest.MonkeyPatch) -> None:
    """开启维护读模式，并把窗口设为当前时间前后各 30 分钟（自动兼容跨午夜）。"""
    now = datetime.now(SHANGHAI_TZ)
    monkeypatch.setattr(settings, "maintenance_read_only_enabled", True)
    monkeypatch.setattr(
        settings, "maintenance_read_only_start", (now - timedelta(minutes=30)).strftime("%H:%M")
    )
    monkeypatch.setattr(
        settings, "maintenance_read_only_end", (now + timedelta(minutes=30)).strftime("%H:%M")
    )


def test_login_not_blocked_in_maintenance(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """认证路径放行：登录即使失败也不应被维护模式拦截。"""
    _enable_window_covering_now(monkeypatch)
    resp = client.post("/api/auth/login", json={"account": "nobody", "password": "wrong"})
    assert resp.status_code != 503


def test_business_write_blocked_in_maintenance(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    _enable_window_covering_now(monkeypatch)
    resp = client.post("/api/questions", json={"title": "t", "content": "c", "course_id": 1})
    assert resp.status_code == 503
    body = resp.json()
    assert body["code"] == 503
    assert body["data"] is None
    assert body["message"] == "系统维护中，当前仅支持浏览与问答"
    assert resp.headers["content-type"].startswith("application/json")


def test_business_read_not_blocked_in_maintenance(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    _enable_window_covering_now(monkeypatch)
    assert client.get("/api/questions").status_code != 503


def test_write_allowed_when_disabled(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    """关闭开关后写请求交给业务处理（无登录态时为 401，但不应是 503）。"""
    monkeypatch.setattr(settings, "maintenance_read_only_enabled", False)
    monkeypatch.setattr(settings, "maintenance_read_only_start", "00:00")
    monkeypatch.setattr(settings, "maintenance_read_only_end", "23:59")
    resp = client.post("/api/questions", json={"title": "t", "content": "c", "course_id": 1})
    assert resp.status_code != 503
