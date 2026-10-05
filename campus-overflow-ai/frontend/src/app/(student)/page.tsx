import { RightRail } from "@/features/home/RightRail";
import { QuestionList } from "@/features/questions/QuestionList";
import type { QuestionSort } from "@/shared/types/question";

// 学生端首页 = 问题广场（P-S01）；顶栏由 (student)/layout.tsx 提供
export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ keyword?: string; sort?: string; unresolved?: string }>;
}) {
  const { keyword, sort, unresolved } = await searchParams;

  return (
    <main className="mx-auto max-w-[1280px] px-4 py-6 sm:px-8">
      {/* 学生端布局：顶栏 + 内容区 + 右栏（前端服务需求文档 §3.1） */}
      <div className="flex flex-col gap-6 lg:flex-row">
        <div className="min-w-0 flex-1">
          <QuestionList
            // 顶栏搜索改变 keyword 时用 key 重置列表状态（避免在 effect 中同步 setState）
            key={keyword ?? "all"}
            initialKeyword={keyword ?? ""}
            initialSort={(sort === "hot" ? "hot" : "latest") as QuestionSort}
            initialUnresolved={unresolved === "1"}
          />
        </div>
        <aside className="w-full shrink-0 lg:w-[280px]">
          <RightRail />
        </aside>
      </div>
    </main>
  );
}
