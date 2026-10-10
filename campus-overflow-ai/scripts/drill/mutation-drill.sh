#!/usr/bin/env bash
# =============================================================================
# 缺陷注入演练（手工变异测试，适配自 agentic-java-lab-reference/drill）。
# 把 drill/mutants/*.patch 中"智能体常犯的错误"逐个打到当前实现上，
# 运行全量 pytest，观察测试套能否"杀死"缺陷：
#   - 存活 = 测试盲区（该回归不会被任何现有测试抓住），需要补测试；
#   - 杀死 = 套件对这类错误有免疫力。
# 前置：git 工作区干净（脚本会用 git apply / git apply -R 打入与回滚变异）。
# 用法：bash campus-overflow-ai/scripts/drill/mutation-drill.sh
#       （Windows 无 PATH bash 时：
#        & "C:\Program Files\Git\bin\bash.exe" campus-overflow-ai/scripts/drill/mutation-drill.sh）
# =============================================================================
set -u
cd "$(dirname "$0")/../../.."   # 仓库根

MUTANT_DIR=campus-overflow-ai/scripts/drill/mutants

run_tests() { (cd campus-overflow-ai/backend && uv run pytest -q "$@"); }

[ -z "$(git status --porcelain campus-overflow-ai/backend)" ] || {
  echo "backend 工作区不干净，先提交或暂存后再演练"; exit 1;
}

echo "基线检查：未注入缺陷时应全部通过……"
run_tests >/dev/null 2>&1 || { echo "基线失败，请先修复工程"; exit 1; }

printf "\n%-32s | %-6s | 杀手测试提示\n" "变异体" "结果"
printf -- "---------------------------------+--------|------------------\n"
killed=0; total=0
for p in "$MUTANT_DIR"/*.patch; do
  [ -z "${ONLY:-}" ] || case "$(basename "$p")" in "$ONLY"*) ;; *) continue;; esac
  git apply "$p" || { printf "%-32s | %-6s\n" "$(basename "$p" .patch)" "APPLY失败"; continue; }
  if run_tests -x >/dev/null 2>&1; then
    result="存活"
  else
    result="杀死"; killed=$((killed+1))
    # 记录是哪些测试杀死了变异（供归档定位）
    run_tests -x --tb=no 2>&1 | grep -E "^FAILED|^ERROR" | head -3 > "$p.killer" || true
  fi
  git apply -R "$p" || { echo "【回滚失败】强制恢复工作区"; git checkout -- campus-overflow-ai/backend; }
  total=$((total+1))
  printf "%-32s | %-6s\n" "$(basename "$p" .patch)" "$result"
done

echo
echo "杀死率：$killed/$total（存活项为测试盲区，按 .killer 文件定位后补测试）"
[ "$killed" -eq "$total" ] && echo "DRILL-PASS：全部变异被杀死" || echo "DRILL-GAP：存在存活变异"
