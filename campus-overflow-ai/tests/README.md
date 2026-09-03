# Cross-Service Tests

Reserved for cross-service and end-to-end tests.

Service-level tests should stay inside each service:

- backend tests: `backend/tests/`
- frontend tests: `frontend/src/**/*.test.ts(x)`
- agent tests: `agent/tests/`

Use this directory only for flows that need more than one service running.
