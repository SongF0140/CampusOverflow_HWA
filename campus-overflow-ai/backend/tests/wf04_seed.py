"""仅供WF-04独立MySQL端到端验收；不读取默认业务库。"""

import json
from datetime import UTC, datetime, timedelta
from uuid import uuid4

from sqlalchemy.engine import make_url

from app.core.config import settings
from app.core.security import create_access_token
from app.db.session import SessionLocal
from app.modules.courses.models import Course
from app.modules.governance import models as governance_models  # noqa: F401
from app.modules.identity.models import User
from app.modules.interaction import models as interaction_models  # noqa: F401
from app.modules.qa.models import Question

url = make_url(settings.database_url)
assert url.host == "127.0.0.1" and url.port == 53306 and url.database == "campus_wf04"
with SessionLocal() as db:
    suffix = uuid4().hex[:10]
    admin = User(
        username=f"wf04_admin_{suffix}",
        email=f"a{suffix}@test.invalid",
        password_hash="test-only-unusable",
        role="admin",
    )
    student = User(
        username=f"wf04_student_{suffix}",
        email=f"s{suffix}@test.invalid",
        password_hash="test-only-unusable",
        role="student",
    )
    db.add_all([admin, student])
    db.flush()
    course = Course(name="WF04隔离验收", code=f"WF04{suffix}", teacher_id=admin.id)
    db.add(course)
    db.flush()
    question = Question(
        title="验收问题",
        body="普通内容" * 80 + "尾部风险",
        author_id=student.id,
        course_id=course.id,
    )
    db.add(question)
    recovery = Question(
        title="异常收尾验收", body="收尾测试", author_id=student.id, course_id=course.id
    )
    db.add(recovery)
    historical = [
        Question(
            title=f"历史发现{i}",
            body="历史内容",
            author_id=student.id,
            course_id=course.id,
            created_at=datetime.now(UTC).replace(tzinfo=None) - timedelta(days=2),
        )
        for i in range(105)
    ]
    db.add_all(historical)
    db.commit()
    print(
        json.dumps(
            {
                "question_id": question.id,
                "admin_token": create_access_token(admin.id, "admin"),
                "student_token": create_access_token(student.id, "student"),
                "recovery_question_id": recovery.id,
                "historical_ids": [row.id for row in historical],
            }
        )
    )
