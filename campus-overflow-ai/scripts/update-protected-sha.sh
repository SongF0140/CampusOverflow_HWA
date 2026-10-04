#!/usr/bin/env bash
# =============================================================================
# 刷新受保护文件（规格冻结基线）的 SHA-256 基线。
# 前置：受保护文件的修改已经过人工确认（宪法/spec/plan 属 WHAT 层，
#       改动必须同步重跑 specs/analyze.md 一致性分析，见 AGENTS.md 工作流程）。
# 生成：campus-overflow-ai/scripts/protected.sha256（pre-commit 钩子据此拦截）
# =============================================================================
set -e
root="$(git rev-parse --show-toplevel)"
cd "$root"

PROTECTED=(
  AGENTS.md
  .gitattributes
  .trae/rules/coding-style.md
  .trae/rules/conventions.md
  .trae/rules/project-context.md
  specs/constitution.md
  specs/spec.md
  specs/plan.md
)

: > campus-overflow-ai/scripts/protected.sha256
for f in "${PROTECTED[@]}"; do
  [ -f "$f" ] || { echo "缺失受保护文件：$f" >&2; exit 1; }
  # 规范化为 "<hash>  <path>"（Git Bash 的 sha256sum 二进制模式输出 "hash *path"，统一去掉星号）
  sha256sum "$f" | sed 's/^\([0-9a-f]\{64\}\) \*/\1  /' >> campus-overflow-ai/scripts/protected.sha256
done
echo "基线已刷新：campus-overflow-ai/scripts/protected.sha256（$((${#PROTECTED[@]})) 个文件）"
echo "请将本次规格变更连同基线一起提交，并确认 specs/analyze.md 已重跑。"
