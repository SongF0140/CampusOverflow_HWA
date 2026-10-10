"""规格规则↔测试覆盖检查（宪法"规则必须是可检查的"的机械化落实）。

从 specs/spec.md 提取全部 E-xx / X-xx 规则编号，检查每条规则在
campus-overflow-ai/backend/tests/ 下是否至少被一个测试文件引用
（docstring / 注释 / 函数名中出现编号即算）。

用法：
    python campus-overflow-ai/scripts/check_spec_coverage.py
退出码：0 全部非豁免规则已覆盖；1 存在缺口。

豁免清单有因必查：二期条目与未到期任务随 specs/tasks.md 推进逐项摘帽，
摘帽时从 WAIVERS 删除对应行即可（spec.md §7 注明阶段口径）。
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SPEC = ROOT / "specs" / "spec.md"
TESTS = ROOT / "campus-overflow-ai" / "backend" / "tests"

# 豁免规则：随任务推进逐项摘帽（理由须引用 spec.md 阶段注记或 tasks.md 任务号）
WAIVERS: dict[str, str] = {
    "E-03": "标签模块随 T-07 落地",
    "E-04": "投票唯一约束随 T-08 落地",
    "E-09": "AI 推荐标签为第二阶段能力（spec US-11/12）",
    "E-11": "通知/积分流水的本人可见性随 T-08/T-10 落地",
    "X-01": "存储不可用降级以前端兜底为主，后端 500 统一格式由 core/errors.py 覆盖",
    "X-02": "AI 服务不可用为第二阶段（spec §5 X-02）",
    "X-04": "数据不合法回退展示以前端为主，后端 422 归一 400 已由 errors.py 覆盖",
    "X-05": "第二阶段（spec §5 X-05）",
    "X-06": "第二阶段（spec §5 X-06，本期仅表结构预留）",
}


def extract_rule_ids() -> list[str]:
    """从 spec.md 提取全部 E-xx / X-xx 编号（去重按编号排序）。"""
    text = SPEC.read_text(encoding="utf-8")
    ids = set(re.findall(r"\b([EX]-\d{2})\b", text))
    return sorted(ids)


def collect_test_text() -> str:
    """拼接 tests/ 下全部测试源码，供编号引用检查。"""
    chunks: list[str] = []
    for path in sorted(TESTS.rglob("*.py")):
        chunks.append(path.read_text(encoding="utf-8"))
    return "\n".join(chunks)


def main() -> int:
    rule_ids = extract_rule_ids()
    if not rule_ids:
        print(f"错误：未从 {SPEC} 提取到任何规则编号", file=sys.stderr)
        return 1
    test_text = collect_test_text()

    print(f"规则宇宙：{len(rule_ids)} 条（specs/spec.md）  测试目录：{TESTS}")
    print()
    uncovered: list[str] = []
    print(f"{'规则':<6} {'状态':<10} 说明")
    print("-" * 60)
    for rid in rule_ids:
        if rid in WAIVERS:
            print(f"{rid:<6} {'豁免':<10} {WAIVERS[rid]}")
        elif rid in test_text:
            print(f"{rid:<6} {'已覆盖':<10}")
        else:
            uncovered.append(rid)
            print(f"{rid:<6} {'缺失':<10} 测试代码中未引用该编号")

    print("-" * 60)
    if uncovered:
        print(f"未通过：{len(uncovered)} 条规则缺测试覆盖：{'、'.join(uncovered)}")
        print("请在测试 docstring/名称中标注规则编号（如 E-05），或确认豁免理由。")
        return 1
    print("通过：全部非豁免规则均有测试引用")
    return 0


if __name__ == "__main__":
    sys.exit(main())
