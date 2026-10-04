import Link from "next/link";

export const metadata = { title: "无访问权限 · CampusOverflow" };

export default function ForbiddenPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-panel px-6 py-10 text-center">
      <p className="text-[36px] font-semibold text-ink">403</p>
      <h1 className="text-[20px] font-semibold text-ink">你当前的角色没有访问权限</h1>
      <p className="max-w-[42ch] text-[13px] leading-relaxed text-ink-muted">
        这个页面属于其他端（学生端 / 教师端 / 管理端）。如果你认为这是误判，请联系课程管理员。
      </p>
      <div className="mt-2 flex gap-3">
        <Link
          href="/"
          className="co-focusable rounded-md bg-brand px-4 py-2 text-[14px] font-medium text-white transition-colors duration-150 ease-standard hover:bg-brand-strong"
        >
          回到问题广场
        </Link>
        <Link
          href="/auth/login"
          className="co-focusable rounded-md border border-line bg-canvas px-4 py-2 text-[14px] font-medium text-ink transition-colors duration-150 ease-standard hover:bg-panel"
        >
          切换账号
        </Link>
      </div>
    </main>
  );
}
