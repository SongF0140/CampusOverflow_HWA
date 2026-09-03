# Deploy Structure

Deployment files live here.

- `nginx/`: reverse proxy configuration.
- `mysql/`: MySQL initialization assets.
- `redis/`: optional Redis configuration for later caching, rate limiting, or ranking.
- `backend.Dockerfile`: planned backend image definition.
- `frontend.Dockerfile`: planned frontend image definition.
- `agent.Dockerfile`: planned Agent image definition.
- `docker-compose.prod.yml`: planned production-like compose file.

Phase 1 can start with local dev commands. Docker configuration should be added
when service contracts and health checks are stable.
