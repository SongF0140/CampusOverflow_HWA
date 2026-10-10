import { Suspense } from "react";

import { QuestionBoard } from "@/features/home/QuestionBoard";
import { LoadingSkeleton } from "@/shared/components";

// 学生端首页 = 问题广场（P-S01，页面控件级设计说明 §2.3）
// 筛选状态以 URL searchParams 为唯一来源，由 QuestionBoard（client）自行读写；
// useSearchParams 需要 Suspense 边界，静态预渲染时回退骨架
export default function HomePage() {
  return (
    <main className="mx-auto w-full max-w-[1200px] px-4 py-6 sm:px-8">
      <Suspense
        fallback={
          <div className="flex flex-col gap-5">
            <div className="co-skeleton h-7 w-32 rounded-sm" />
            <div className="co-skeleton h-10 w-full rounded-md" />
            <LoadingSkeleton variant="list" count={5} />
          </div>
        }
      >
        <QuestionBoard />
      </Suspense>
    </main>
  );
}
