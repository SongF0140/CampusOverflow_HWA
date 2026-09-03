# Nginx

Reserved for reverse proxy configuration.

Expected routing:

- `/` -> frontend
- `/api/` -> backend
- `/agent/` -> agent
- `/docs/api` -> backend OpenAPI docs

Do not expose `/internal/agent/*` publicly.
