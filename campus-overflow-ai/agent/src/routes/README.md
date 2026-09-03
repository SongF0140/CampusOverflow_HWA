# Agent Routes

Hono route modules live here.

Routes should validate input, create or pass trace context, call the Agent loop,
and stream or return structured responses. Core task logic belongs in `src/tasks/`.
