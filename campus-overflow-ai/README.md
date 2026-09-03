# CampusOverflow AI Codebase

This directory contains the runnable code skeleton for the project.

- `frontend/`: Next.js frontend, BFF route handlers, and AI streaming UI.
- `backend/`: FastAPI business backend, RBAC, CRUD, transactions, and MySQL access.
- `agent/`: TypeScript Agent Runtime based on a single Agent Loop and task router.
- `deploy/`: Docker, Nginx, MySQL, and optional Redis deployment assets.
- `scripts/`: Local development, verification, and deployment helper scripts.
- `tests/`: Cross-service or end-to-end tests.

Core business data must be owned by `backend/`. The Agent service must access
business context through FastAPI internal APIs instead of connecting to MySQL.
