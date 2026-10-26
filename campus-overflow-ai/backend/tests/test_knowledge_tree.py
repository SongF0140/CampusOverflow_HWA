# 知识树与教学计划测试（K-01，KN-R01/R03）：
# BST 插入/中序/叶子删除领域规则 + 教师端接口边界（E-14/E-15/E-16/E-17 写入口唯一）。
import secrets

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.security import hash_password
from app.modules.courses import domain
from app.modules.identity.models import User

# 测试用户密码：进程内随机生成（避免源码硬编码凭据；同进程内创建与登录一致）
TEST_PASSWORD = secrets.token_urlsafe(12)


def _create_user(db: Session, username: str, role: str = "student") -> User:
    """测试辅助：直接在数据库创建用户。"""
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
    """测试辅助：登录并返回 token。"""
    resp = client.post(
        "/api/auth/login",
        json={"account": username, "password": TEST_PASSWORD},
    )
    return resp.json()["data"]["access_token"]


def _create_course(client: TestClient, token: str, code: str) -> dict:
    """测试辅助：教师创建课程并返回 data。"""
    resp = client.post(
        "/api/courses",
        headers={"Authorization": f"Bearer {token}"},
        json={"name": "操作系统", "code": code, "semester": "2026 秋"},
    )
    return resp.json()["data"]


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _save_report(client: TestClient, course_id: int, week_start: str, run_id: str) -> int:
    """测试辅助：经内部接口保存周报并返回 report_id。"""
    resp = client.post(
        "/internal/agent/reports",
        headers={"X-Service-Token": settings.agent_service_token},
        json={
            "course_id": course_id,
            "week_start": week_start,
            "week_end": week_start,
            "content": "本周学生提问集中在进程调度，建议补充实例讲解。",
            "uncovered_topics": [
                {"topic": "内存置换算法", "question_count": 3, "suggestion": "建议拓宽该知识点"}
            ],
            "heatmap": [{"node_id": 1, "node_name": "进程", "question_count": 5}],
            "question_count": 8,
            "agent_run_id": run_id,
        },
    )
    assert resp.status_code == 200
    return resp.json()["data"]["id"]


# ---------- 领域规则（BST，纯函数；中文码点序：死 < 线 < 调 < 进） ----------


def test_bst_insert_positions() -> None:
    """空树成根；此后小于走左、大于走右、相等拒绝（E-15）。"""
    assert domain.find_insert_position([], "线程") == (None, None)
    # 根=线程(1)；死锁 < 线程 → 左；调度 > 线程 → 右；进程 > 调度 → 调度的右子
    rows: list[domain.NodeRow] = [(1, "线程", None, None)]
    assert domain.find_insert_position(rows, "死锁") == (1, "left")
    rows.append((2, "死锁", 1, "left"))
    assert domain.find_insert_position(rows, "调度") == (1, "right")
    rows.append((3, "调度", 1, "right"))
    assert domain.find_insert_position(rows, "进程") == (3, "right")
    rows.append((4, "进程", 3, "right"))
    with pytest.raises(domain.KnowledgeDuplicateError):
        domain.find_insert_position(rows, "调度")


def test_bst_inorder_is_sorted() -> None:
    """中序遍历产出 sort_key 升序序列（左 → 根 → 右）。"""
    # 合法 BST：根=线程；线程.left=死锁；线程.right=调度；调度.right=进程
    rows: list[domain.NodeRow] = [
        (1, "线程", None, None),
        (2, "死锁", 1, "left"),
        (3, "调度", 1, "right"),
        (4, "进程", 3, "right"),
    ]
    # 升序：死锁(6B7B) < 线程(7EBF) < 调度(8C03) < 进程(8FDB)
    assert domain.inorder_ids(rows) == [2, 1, 3, 4]
    assert domain.inorder_ids([]) == []


def test_bst_leaf_delete_and_name_rules() -> None:
    """仅叶子可删（E-16）；名称空白/超长拒绝；计划字段校验。"""
    rows: list[domain.NodeRow] = [
        (1, "线程", None, None),
        (2, "死锁", 1, "left"),
    ]
    with pytest.raises(domain.KnowledgeNodeHasChildrenError):
        domain.ensure_node_is_leaf(rows, 1)
    domain.ensure_node_is_leaf(rows, 2)

    with pytest.raises(domain.KnowledgeNameInvalidError):
        domain.ensure_knowledge_name("   ")
    with pytest.raises(domain.KnowledgeNameInvalidError):
        domain.ensure_knowledge_name("长" * (domain.KNOWLEDGE_NAME_MAX_LEN + 1))
    domain.ensure_knowledge_name("线程调度")

    with pytest.raises(domain.TeachingPlanInvalidError):
        domain.ensure_plan_item_fields(" ", None, None)
    with pytest.raises(domain.TeachingPlanInvalidError):
        domain.ensure_plan_item_fields("标题", None, "invalid")
    domain.ensure_plan_item_fields("补充进程调度讲解", "下周一课前", "done")


# ---------- 知识树接口 ----------


def test_knowledge_tree_empty_then_built_inorder(
    client: TestClient, db_session: Session
) -> None:
    """教师乱序批量建树：BST 结构正确、中序升序；学生可读（Q-09④）。"""
    _create_user(db_session, "kt_teacher", "teacher")
    _create_user(db_session, "kt_student", "student")
    t_token = _login(client, "kt_teacher")
    s_token = _login(client, "kt_student")
    course = _create_course(client, t_token, "CS-KT-1")

    # 空树可读
    resp = client.get(f"/api/courses/{course['id']}/knowledge-tree", headers=_auth(s_token))
    assert resp.status_code == 200
    assert resp.json()["data"]["nodes"] == []

    # 乱序插入四个知识点（中文码点序：死锁 < 线程调度 < 进程 < 进程同步）
    resp = client.post(
        f"/api/courses/{course['id']}/knowledge-tree/nodes",
        headers=_auth(t_token),
        json={"names": ["死锁", "进程", "线程调度", "进程同步"]},
    )
    assert resp.status_code == 200
    data = resp.json()["data"]
    names_inorder = [n["name"] for n in data["inorder"]]
    assert names_inorder == ["死锁", "线程调度", "进程", "进程同步"]

    # BST 结构：根=死锁；进程=死锁.right；线程调度=进程.left；进程同步=进程.right
    by_name = {n["name"]: n for n in data["nodes"]}
    assert by_name["死锁"]["parent_id"] is None
    assert by_name["进程"]["parent_id"] == by_name["死锁"]["id"]
    assert by_name["进程"]["position"] == "right"
    assert by_name["线程调度"]["parent_id"] == by_name["进程"]["id"]
    assert by_name["线程调度"]["position"] == "left"
    assert by_name["进程同步"]["parent_id"] == by_name["进程"]["id"]
    assert by_name["进程同步"]["position"] == "right"
    # 嵌套树形：根列表仅一个根
    assert len(data["tree"]) == 1
    assert data["tree"][0]["name"] == "死锁"
    assert data["tree"][0]["children"][0]["name"] == "进程"

    # 学生可读同一棵树（师生可见）
    resp = client.get(f"/api/courses/{course['id']}/knowledge-tree", headers=_auth(s_token))
    assert resp.status_code == 200
    assert [n["name"] for n in resp.json()["data"]["inorder"]] == names_inorder


def test_knowledge_tree_duplicate_and_permission(
    client: TestClient, db_session: Session
) -> None:
    """重复知识点 400（E-15）；非负责教师与学生写入 403（E-14）；未登录读 401。"""
    _create_user(db_session, "kt_owner", "teacher")
    _create_user(db_session, "kt_other", "teacher")
    _create_user(db_session, "kt_student2", "student")
    owner_token = _login(client, "kt_owner")
    other_token = _login(client, "kt_other")
    student_token = _login(client, "kt_student2")
    course = _create_course(client, owner_token, "CS-KT-2")

    # 他人课程教师建树 403；学生建树 403
    resp = client.post(
        f"/api/courses/{course['id']}/knowledge-tree/nodes",
        headers=_auth(other_token),
        json={"names": ["进程"]},
    )
    assert resp.status_code == 403
    resp = client.post(
        f"/api/courses/{course['id']}/knowledge-tree/nodes",
        headers=_auth(student_token),
        json={"names": ["进程"]},
    )
    assert resp.status_code == 403

    # 负责教师建树后：与现有重复、同批重复均 400
    resp = client.post(
        f"/api/courses/{course['id']}/knowledge-tree/nodes",
        headers=_auth(owner_token),
        json={"names": ["进程", "线程"]},
    )
    assert resp.status_code == 200
    resp = client.post(
        f"/api/courses/{course['id']}/knowledge-tree/nodes",
        headers=_auth(owner_token),
        json={"names": ["进程"]},
    )
    assert resp.status_code == 400
    resp = client.post(
        f"/api/courses/{course['id']}/knowledge-tree/nodes",
        headers=_auth(owner_token),
        json={"names": ["死锁", "死锁 "]},
    )
    assert resp.status_code == 400

    # 未登录读树 401；不存在的课程 404
    assert (
        client.get(f"/api/courses/{course['id']}/knowledge-tree").status_code == 401
    )
    assert (
        client.get(
            f"/api/courses/{course['id'] + 999}/knowledge-tree",
            headers=_auth(student_token),
        ).status_code
        == 404
    )


def test_knowledge_tree_delete_leaf_only(
    client: TestClient, db_session: Session
) -> None:
    """删叶子成功且树内序更新；删有子节点 400（E-16）；删不存在 404。"""
    _create_user(db_session, "kt_del_teacher", "teacher")
    token = _login(client, "kt_del_teacher")
    course = _create_course(client, token, "CS-KT-3")
    resp = client.post(
        f"/api/courses/{course['id']}/knowledge-tree/nodes",
        headers=_auth(token),
        json={"names": ["进程", "线程", "死锁"]},
    )
    nodes = {n["name"]: n for n in resp.json()["data"]["nodes"]}

    # 线程、死锁均为进程左链上的节点：删除进程（有子）→ 400
    resp = client.delete(
        f"/api/courses/{course['id']}/knowledge-tree/nodes/{nodes['进程']['id']}",
        headers=_auth(token),
    )
    assert resp.status_code == 400
    # 删除叶子（死锁，进程左链最深处）成功
    resp = client.delete(
        f"/api/courses/{course['id']}/knowledge-tree/nodes/{nodes['死锁']['id']}",
        headers=_auth(token),
    )
    assert resp.status_code == 200
    names = [n["name"] for n in resp.json()["data"]["inorder"]]
    assert names == ["线程", "进程"]
    # 删除不存在的节点 404
    resp = client.delete(
        f"/api/courses/{course['id']}/knowledge-tree/nodes/{nodes['死锁']['id']}",
        headers=_auth(token),
    )
    assert resp.status_code == 404


# ---------- 教学计划接口（KN-R03） ----------


def test_teaching_plan_crud(client: TestClient, db_session: Session) -> None:
    """教学计划手动创建/列表/更新状态/删除；周报来源标记（report_id）。"""
    _create_user(db_session, "plan_teacher", "teacher")
    token = _login(client, "plan_teacher")
    course = _create_course(client, token, "CS-PLAN-1")

    # 创建手动条目
    resp = client.post(
        f"/api/courses/{course['id']}/teaching-plan",
        headers=_auth(token),
        json={"title": "补充进程调度讲解", "detail": "结合最新提问调整课件"},
    )
    assert resp.status_code == 200
    item = resp.json()["data"]
    assert item["source"] == "manual"
    assert item["status"] == "pending"

    # 周报来源条目：先经内部接口保存真实周报，再引用其 ID（K-02 起校验存在与归属）
    report_id = _save_report(client, course["id"], "2026-10-13", "run-plan-1")
    resp = client.post(
        f"/api/courses/{course['id']}/teaching-plan",
        headers=_auth(token),
        json={"title": "拓宽内存置换算法知识点", "report_id": report_id},
    )
    assert resp.status_code == 200
    report_item = resp.json()["data"]
    assert report_item["source"] == "report"
    assert report_item["report_id"] == report_id

    # 不存在的周报 404；跨课程伪造周报引用 404
    resp = client.post(
        f"/api/courses/{course['id']}/teaching-plan",
        headers=_auth(token),
        json={"title": "伪造来源", "report_id": report_id + 999},
    )
    assert resp.status_code == 404

    # 列表（最新在前）与状态更新
    resp = client.get(
        f"/api/courses/{course['id']}/teaching-plan", headers=_auth(token)
    )
    assert resp.status_code == 200
    assert resp.json()["data"]["total"] == 2
    resp = client.patch(
        f"/api/courses/{course['id']}/teaching-plan/{item['id']}",
        headers=_auth(token),
        json={"status": "done"},
    )
    assert resp.status_code == 200
    assert resp.json()["data"]["status"] == "done"

    # 非法状态 400；删除后列表为空
    resp = client.patch(
        f"/api/courses/{course['id']}/teaching-plan/{item['id']}",
        headers=_auth(token),
        json={"status": "invalid"},
    )
    assert resp.status_code == 400
    for target in (item["id"], report_item["id"]):
        assert (
            client.delete(
                f"/api/courses/{course['id']}/teaching-plan/{target}",
                headers=_auth(token),
            ).status_code
            == 200
        )
    resp = client.get(
        f"/api/courses/{course['id']}/teaching-plan", headers=_auth(token)
    )
    assert resp.json()["data"]["total"] == 0


def test_teaching_plan_permission(client: TestClient, db_session: Session) -> None:
    """教学计划仅课程负责教师与管理员可见可管（E-14）；他人课程教师/学生 403。"""
    _create_user(db_session, "plan_owner", "teacher")
    _create_user(db_session, "plan_other", "teacher")
    _create_user(db_session, "plan_student", "student")
    owner_token = _login(client, "plan_owner")
    other_token = _login(client, "plan_other")
    student_token = _login(client, "plan_student")
    course = _create_course(client, owner_token, "CS-PLAN-2")
    url = f"/api/courses/{course['id']}/teaching-plan"

    assert client.get(url, headers=_auth(owner_token)).status_code == 200
    assert client.get(url, headers=_auth(other_token)).status_code == 403
    assert client.get(url, headers=_auth(student_token)).status_code == 403
    assert (
        client.post(
            url, headers=_auth(other_token), json={"title": "越权条目"}
        ).status_code
        == 403
    )
    # 负责教师自己的知识树与教学计划入口不受影响
    assert (
        client.post(
            f"/api/courses/{course['id']}/knowledge-tree/nodes",
            headers=_auth(owner_token),
            json={"names": ["进程"]},
        ).status_code
        == 200
    )
