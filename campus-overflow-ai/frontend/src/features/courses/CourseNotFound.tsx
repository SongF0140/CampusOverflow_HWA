import Link from "next/link";

import { ErrorState } from "@/shared/components";

// 课程不存在 / 软删（或路由参数非法）的 404 视图
export function CourseNotFound() {
  return (
    <div className="flex flex-col items-start gap-3">
      <ErrorState message="课程不存在或已删除" />
      <Link
        href="/courses"
        className="co-focusable w-fit rounded-md border border-line px-3 py-1.5 text-[13px] font-medium text-ink transition-colors duration-150 ease-standard hover:bg-panel"
      >
        返回课程列表
      </Link>
    </div>
  );
}
