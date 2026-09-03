# Backend Modules

Business modules live here. Each module should eventually follow this shape:

- `models.py`: SQLAlchemy models.
- `schemas.py`: Pydantic request and response schemas.
- `service.py`: business rules, permissions, and transactions.
- `router.py`: FastAPI routes.
- `repository.py`: optional data access wrapper.
- `events.py`: optional domain events.

Do not put core business rules in routers. Agent-facing internal APIs should be
implemented through `agent_gateway/` and must call normal business services.
