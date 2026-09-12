import subprocess
import sys

repo = r"C:\Users\lenovo\CampusOverflow_HWA"

def run_git(args):
    result = subprocess.run(["git"] + args, cwd=repo, capture_output=True, text=True, encoding="utf-8")
    print(f"$ git {' '.join(args)}")
    if result.stdout:
        print(result.stdout)
    if result.stderr:
        print(result.stderr, file=sys.stderr)
    print(f"[exit code: {result.returncode}]")
    return result

print("=== 当前分支 ===")
run_git(["branch"])

print("\n=== 切换到 feat/add-task-A ===")
run_git(["checkout", "feat/add-task-A"])

print("\n=== 切换后状态 ===")
run_git(["status"])

print("\n=== 最近提交 ===")
run_git(["log", "--oneline", "-5"])
