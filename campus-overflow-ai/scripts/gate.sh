#!/usr/bin/env bash
# =============================================================================
# 后端全量质量门禁（增量开发纪律的"完成声明"前置检查）
# 用法：bash campus-overflow-ai/scripts/gate.sh   （工作区任意位置可执行）
# 四道闸门：pytest 全量 → ruff → lint-imports → alembic check（模型与迁移一致）
# 任一失败即非零退出；任务收尾前必须全绿（对应 AGENTS.md 硬性约束 7/8）。
# =============================================================================
set -e
cd "$(dirname "$0")/../backend"

echo "== [1/4] pytest 全量 =="
uv run pytest -q

echo "== [2/4] ruff =="
uv run ruff check .

echo "== [3/4] lint-imports（架构契约 D-6）=="
uv run lint-imports

echo "== [4/4] alembic check（模型与迁移一致性）=="
uv run alembic check

echo "GATE-PASS：四道闸门全部通过"
