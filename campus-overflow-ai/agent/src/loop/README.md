# Agent Loop

Phase 1 Agent orchestration belongs here.

The loop should own observe, plan, act, self-check, and record steps. It should
delegate concrete task behavior to `src/tasks/` and tool execution to
`src/tools/registry.ts`.
