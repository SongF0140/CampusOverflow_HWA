# Agents Extension Point

This directory is reserved for phase 2 role-based Agent extensions.

Phase 1 uses a single Agent Loop with a task router. Do not place core task
logic here during phase 1. Put loop orchestration in `src/loop/`, task handlers
in `src/tasks/`, tools in `src/tools/`, memory access in `src/memory/`, approval
logic in `src/approvals/`, and tracing/logging helpers in `src/observability/`.
