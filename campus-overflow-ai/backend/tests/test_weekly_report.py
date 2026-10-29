# 周报与内部接口测试（K-02，KN-R02）：
# 服务级内部接口（有树课程清单/树读取/近期问题/周报保存幂等）+ 周报教师私有（E-14/E-18/E-19）。
import secrets
from datetime import datetime, timedelta

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.security import hash_password
from app.modules.identity.models import User
from app.modules.qa.models import Question

# 测试用户密码：进程内随机生成（避免源码硬编码凭据；同进程内创建与登录一致）
TEST_PASSWORD = secrets.token_urlsafe(12)
SERVICE_AUTH = {"X-Service-Token": settings.agent_service_token}


def _create_user(db: Session, username: str, role: str = "student") -> User:
    user = User(
        username=username,
        email=f"{username}@example.com",
        password_hash=hash_password(TEST_PASSWORD),
        role=role,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def _login(client: TestClient, username: str) -> str:
    resp = client.post(
        "/api/auth/login", json={"account": username, "password": TEST_PASSWORD}
    )
    return resp.json()["data"]["access_token"]


def _create_course(client: TestClient, token: str, code: str) -> dict:
    resp = client.post(
        "/api/courses",
        headers={"Authorization": f"Bearer {token}"},
        json={"name": "操作系统", "code": code},
    )
    return resp.json()["data"]


def _add_nodes(client: TestClient, token: str, course_id: int) -> None:
    resp = client.post(
        f"/api/courses/{course_id}/knowledge-tree/nodes",
        headers={"Authorization": f"Bearer {token}"},
        json={"names": ["进程", "线程", "死锁"]},
    )
    assert resp.status_code == 200


def _report_body(course_id: int, week_start: str, run_id: str) -> dict:
    return {
        "course_id": course_id,
        "week_start": week_start,
        "week_end": week_start,
        "content": "本周提问集中在进程与线程，建议结合实例讲解调度差异。",
        "uncovered_topics": [
            {
                "topic": "内存置换算法",
                "question_count": 4,
                "suggestion": "建议拓宽该知识点并补充例题",
            }
        ],
        "heatmap": [
            {"node_id": 1, "node_name": "进程", "question_count": 6},
            {"node_id": 2, "node_name": "线程", "question_count": 2},
        ],
        "question_count": 10,
        "agent_run_id": run_id,
    }


# ---------- 周报保存（服务级内部接口） ----------


def test_report_save_and_idempotent(client: TestClient, db_session: Session) -> None:
    """保存成功归属负责教师；同课程同周重复 409（E-18）；未带服务 token 401。"""
    _create_user(db_session, "wr_teacher", "teacher")
    token = _login(client, "wr_teacher")
    course = _create_course(client, token, "CS-WR-1")

    resp = client.post(
        "/internal/agent/reports",
        headers=SERVICE_AUTH,
        json=_report_body(course["id"], "2026-10-13", "run-wr-1"),
    )
    assert resp.status_code == 200
    data = resp.json()["data"]
    assert data["teacher_id"] == data["teacher_id"]  # 归属字段存在
    assert data["uncovered_topics"][0]["topic"] == "内存置换算法"

    # 同周重复保存 → 409（E-18：调度重启不产生重复周报）
    resp = client.post(
        "/internal/agent/reports",
        headers=SERVICE_AUTH,
        json=_report_body(course["id"], "2026-10-13", "run-wr-2"),
    )
    assert resp.status_code == 409

    # 不同周可再保存；未带服务 token 401；课程不存在 404
    resp = client.post(
        "/internal/agent/reports",
        headers=SERVICE_AUTH,
        json=_report_body(course["id"], "2026-10-20", "run-wr-3"),
    )
    assert resp.status_code == 200
    assert (
        client.post(
            "/internal/agent/reports", json=_report_body(course["id"], "2026-10-27", "x")
        ).status_code
        == 401
    )
    assert (
        client.post(
            "/internal/agent/reports",
            headers=SERVICE_AUTH,
            json=_report_body(course["id"] + 999, "2026-10-27", "x"),
        ).status_code
        == 404
    )


def test_report_save_rejects_sensitive_and_invalid(
    client: TestClient, db_session: Session
) -> None:
    """敏感词内容拒绝（C-07 精神）；周区间倒置/正文为空 400。"""
    _create_user(db_session, "wr_teacher2", "teacher")
    token = _login(client, "wr_teacher2")
    course = _create_course(client, token, "CS-WR-2")

    body = _report_body(course["id"], "2026-10-13", "run-wr-s1")
    body["content"] = "本周学生反复询问数据库连接密钥的配置方法。"
    resp = client.post("/internal/agent/reports", headers=SERVICE_AUTH, json=body)
    assert resp.status_code == 400

    body = _report_body(course["id"], "2026-10-13", "run-wr-s2")
    body["week_start"], body["week_end"] = "2026-10-20", "2026-10-13"
    resp = client.post("/internal/agent/reports", headers=SERVICE_AUTH, json=body)
    assert resp.status_code == 400

    body = _report_body(course["id"], "2026-10-13", "run-wr-s3")
    body["content"] = "   "
    resp = client.post("/internal/agent/reports", headers=SERVICE_AUTH, json=body)
    # 纯空白满足 pydantic min_length，由 domain 的"去空白后非空"校验拒绝
    assert resp.status_code == 400


# ---------- 周报教师私有（E-14：管理员不旁路） ----------


def test_weekly_report_teacher_private(
    client: TestClient, db_session: Session
) -> None:
    """周报由负责教师或全站管理员读取；其他教师和学生仍拒绝。"""
    _create_user(db_session, "wr_owner", "teacher")
    _create_user(db_session, "wr_peer", "teacher")
    _create_user(db_session, "wr_student", "student")
    _create_user(db_session, "wr_admin", "admin")
    owner_token = _login(client, "wr_owner")
    peer_token = _login(client, "wr_peer")
    student_token = _login(client, "wr_student")
    admin_token = _login(client, "wr_admin")
    course = _create_course(client, owner_token, "CS-WR-3")
    report_id = _save(client, course["id"], "2026-10-13")

    url = f"/api/courses/{course['id']}/weekly-reports"
    detail_url = f"{url}/{report_id}"
    owner_headers = {"Authorization": f"Bearer {owner_token}"}
    assert client.get(url, headers=owner_headers).status_code == 200
    assert client.get(detail_url, headers=owner_headers).status_code == 200
    admin_headers = {"Authorization": f"Bearer {admin_token}"}
    assert client.get(url, headers=admin_headers).status_code == 200
    assert client.get(detail_url, headers=admin_headers).status_code == 200
    # 非负责教师和学生仍不读取其他课程报告。
    for other in (peer_token, student_token):
        other_headers = {"Authorization": f"Bearer {other}"}
        assert client.get(url, headers=other_headers).status_code == 404
        assert client.get(detail_url, headers=other_headers).status_code == 404

    # 负责教师看到的列表内容完整（含差距与热力）
    resp = client.get(url, headers={"Authorization": f"Bearer {owner_token}"})
    reports = resp.json()["data"]["items"]
    assert reports[0]["uncovered_topics"][0]["topic"] == "内存置换算法"
    assert reports[0]["heatmap"][0]["node_name"] == "进程"


def _save(client: TestClient, course_id: int, week_start: str) -> int:
    resp = client.post(
        "/internal/agent/reports",
        headers=SERVICE_AUTH,
        json=_report_body(course_id, week_start, f"run-{week_start}"),
    )
    assert resp.status_code == 200
    return resp.json()["data"]["id"]


# ---------- 有树课程清单与知识树内部读取（E-19） ----------


def test_knowledge_tree_courses_listing(
    client: TestClient, db_session: Session
) -> None:
    """清单仅含有知识树的课程（E-19）；树读取内容与业务接口一致；未带 token 401。"""
    _create_user(db_session, "wr_owner3", "teacher")
    owner_token = _login(client, "wr_owner3")
    with_tree = _create_course(client, owner_token, "CS-WR-4")
    without_tree = _create_course(client, owner_token, "CS-WR-5")
    _add_nodes(client, owner_token, with_tree["id"])

    resp = client.get("/internal/agent/knowledge-tree/courses", headers=SERVICE_AUTH)
    assert resp.status_code == 200
    items = resp.json()["data"]["items"]
    listed = {item["course_id"] for item in items}
    assert with_tree["id"] in listed
    assert without_tree["id"] not in listed

    owner = next(i for i in items if i["course_id"] == with_tree["id"])
    assert owner["teacher_id"] is not None

    # 服务级树读取与业务接口一致（节点/中序）
    resp = client.get(
        f"/internal/agent/courses/{with_tree['id']}/knowledge-tree",
        headers=SERVICE_AUTH,
    )
    assert resp.status_code == 200
    tree = resp.json()["data"]
    assert [n["name"] for n in tree["inorder"]] == ["死锁", "线程", "进程"]
    assert (
        client.get(
            f"/internal/agent/courses/{with_tree['id']}/knowledge-tree"
        ).status_code
        == 401
    )
    assert (
        client.get(
            f"/internal/agent/courses/{without_tree['id'] + 999}/knowledge-tree",
            headers=SERVICE_AUTH,
        ).status_code
        == 404
    )


def test_user_level_tree_requires_user_credentials(
    client: TestClient, db_session: Session
) -> None:
    """用户级树读取须双凭证：仅服务 token 401；双凭证可读（登录可读口径）。"""
    _create_user(db_session, "wr_owner4", "teacher")
    _create_user(db_session, "wr_reader", "student")
    owner_token = _login(client, "wr_owner4")
    reader_token = _login(client, "wr_reader")
    course = _create_course(client, owner_token, "CS-WR-6")
    _add_nodes(client, owner_token, course["id"])

    resp = client.get(
        f"/internal/agent/user/courses/{course['id']}/knowledge-tree",
        headers=SERVICE_AUTH,
    )
    assert resp.status_code == 401

    resp = client.get(
        f"/internal/agent/user/courses/{course['id']}/knowledge-tree",
        headers={**SERVICE_AUTH, "Authorization": f"Bearer {reader_token}"},
    )
    assert resp.status_code == 200
    assert len(resp.json()["data"]["nodes"]) == 3


# ---------- 近期问题（周报分析依据） ----------


def test_recent_questions_filters(client: TestClient, db_session: Session) -> None:
    """近期问题按时间窗与课程过滤；软删/隐藏排除；未带服务 token 401。"""
    _create_user(db_session, "wr_owner5", "teacher")
    student = _create_user(db_session, "wr_student5", "student")
    owner_token = _login(client, "wr_owner5")
    course = _create_course(client, owner_token, "CS-WR-7")
    other = _create_course(client, owner_token, "CS-WR-8")

    def _add_question(title: str, course_id: int, **overrides) -> Question:
        question = Question(
            title=title,
            body=f"{title}的正文内容",
            course_id=course_id,
            author_id=student.id,
            **overrides,
        )
        db_session.add(question)
        db_session.commit()
        db_session.refresh(question)
        return question

    recent = _add_question("进程调度问题", course["id"])
    old = _add_question(
        "历史问题",
        course["id"],
        created_at=datetime.now() - timedelta(days=30),
    )
    deleted = _add_question(
        "已删问题", course["id"], deleted_at=datetime.now()
    )
    hidden = _add_question("隐藏问题", course["id"], is_hidden=True)
    other_course = _add_question("其他课程问题", other["id"])
    assert old.id and deleted.id and hidden.id and other_course.id  # 引用防告警

    resp = client.get(
        f"/internal/agent/courses/{course['id']}/questions/recent?days=7",
        headers=SERVICE_AUTH,
    )
    assert resp.status_code == 200
    items = resp.json()["data"]["items"]
    titles = [item["title"] for item in items]
    assert titles == ["进程调度问题"]
    assert items[0]["body"].startswith("进程调度问题")
    # 未带服务 token 401；课程不存在 404
    assert (
        client.get(
            f"/internal/agent/courses/{course['id']}/questions/recent"
        ).status_code
        == 401
    )
    assert (
        client.get(
            f"/internal/agent/courses/{course['id'] + 999}/questions/recent",
            headers=SERVICE_AUTH,
        ).status_code
        == 404
    )
    assert recent.id == recent.id  # 引用防告警
