# Approvals

Human-in-the-loop approval policies live here.

High-risk actions should create approval requests through FastAPI. The Agent
must not directly hide content, delete content, ban users, write files, or call
external MCP tools without policy checks.
