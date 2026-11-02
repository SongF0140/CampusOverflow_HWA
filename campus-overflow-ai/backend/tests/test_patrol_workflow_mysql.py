"""WF-04真实双连接；复用要求显式专用空库、建表后清理的隔离fixture。"""

from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from uuid import uuid4

import pytest
from sqlalchemy import text
from test_approval_requests import setup as seed
from test_governance_execution_concurrency import isolated_mysql as isolated_mysql  # noqa: F401

from app.core.config import settings
from app.modules.governance import (
    repository,
    service_execution_actions,
    service_execution_jobs,
    service_executions,
    service_workflow,
    service_workflow_proposals,
)
from app.modules.governance.schemas_executions import HumanApprovalDecision
from app.modules.governance.schemas_workflow import PatrolWorkflowCreate, WorkflowProposal


def root_request(data):
    return PatrolWorkflowCreate(target_type="question", target_id=data["question"].id)


def test_mysql_concurrent_root_has_one_audit(isolated_mysql, monkeypatch):
    monkeypatch.setattr(settings, "governance_workflow_enabled", True)
    sessions = isolated_mysql
    with sessions() as db:
        data = seed.__wrapped__(db)
        req = root_request(data)
    barrier = Barrier(2)

    def create(_):
        with sessions() as db:
            barrier.wait(timeout=10)
            return service_workflow.create_task(db, req, "wf04-mysql-root")

    with ThreadPoolExecutor(max_workers=2) as pool:
        roots = list(pool.map(create, range(2), timeout=30))
    assert roots[0].task_id == roots[1].task_id
    assert sum(root.repeat for root in roots) == 1
    with sessions() as db:
        assert db.execute(text("SELECT COUNT(*) FROM patrol_workflow_tasks")).scalar() == 1
        assert (
            db.execute(text("SELECT COUNT(*) FROM agent_runs WHERE user_id IS NULL")).scalar() == 1
        )


def system_job(sessions):
    with sessions() as db:
        data = seed.__wrapped__(db)
        root = service_workflow.create_task(db, root_request(data), "wf04-mysql-system")
        proposal = service_workflow_proposals.create_proposal(
            db,
            str(root.task_id),
            WorkflowProposal(
                request_id=uuid4(),
                round=1,
                action="hide",
                reason="隔离验收",
                expected_version=root.initial_version,
                expected_content_version=root.initial_version,
            ),
        )
        approved = service_executions.decide_request(
            db,
            data["admin"].id,
            proposal.request_id,
            HumanApprovalDecision(args_hash=proposal.args_hash, note="逐次批准"),
            approve=True,
        )
        claim = service_execution_jobs.claim(
            db, workflow_task_id=str(root.task_id), execution_id=approved.execution_id
        )
        return claim, data["question"].id


def test_mysql_system_execution_concurrent_once(isolated_mysql, monkeypatch):
    monkeypatch.setattr(settings, "governance_workflow_enabled", True)
    sessions = isolated_mysql
    claim, target = system_job(sessions)
    barrier = Barrier(2)

    def execute(_):
        with sessions() as db:
            barrier.wait(timeout=10)
            return service_execution_actions.execute(
                db, claim.execution_id, claim.lease, claim.lease_epoch
            ).model_dump(mode="json")

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(execute, range(2), timeout=30))
    assert results[0] == results[1]
    with sessions() as db:
        assert (
            db.execute(
                text("SELECT is_hidden FROM questions WHERE id=:id"), {"id": target}
            ).scalar()
            == 1
        )
        assert (
            db.execute(
                text(
                    "SELECT COUNT(*) FROM tool_call_logs "
                    "WHERE tool_name='executeApprovedGovernance'"
                )
            ).scalar()
            == 1
        )


def test_mysql_system_audit_failure_rolls_back(isolated_mysql, monkeypatch):
    monkeypatch.setattr(settings, "governance_workflow_enabled", True)
    sessions = isolated_mysql
    claim, target = system_job(sessions)

    def fail(*args, **kwargs):
        raise RuntimeError("wf04_required_audit_failed")

    monkeypatch.setattr(repository, "finish_governance_execution", fail)
    with sessions() as db, pytest.raises(RuntimeError, match="wf04_required_audit_failed"):
        service_execution_actions.execute(db, claim.execution_id, claim.lease, claim.lease_epoch)
    with sessions() as db:
        assert (
            db.execute(
                text("SELECT is_hidden FROM questions WHERE id=:id"), {"id": target}
            ).scalar()
            == 0
        )
        assert db.execute(text("SELECT result FROM governance_execution_jobs")).scalar() is None
        assert (
            db.execute(
                text("SELECT COUNT(*) FROM agent_runs WHERE task_type='governance_execute'")
            ).scalar()
            == 0
        )
