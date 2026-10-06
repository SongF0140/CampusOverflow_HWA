import { CourseDetailView } from "@/features/courses/CourseDetailView";
import { TopNav } from "@/features/layout/TopNav";
import type { QuestionSort } from "@/shared/types/question";

export const metadata = { title: "课程详情 · CampusOverflow" };

// 课程详情（P-S03）：聚合区块 + 问答区都在 CourseDetailView 内按真接口渲染
export default async function CourseDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ keyword?: string; sort?: string; unresolved?: string }>;
}) {
  const { id } = await params;
  const { keyword, sort, unresolved } = await searchParams;

  return (
    <div className="min-h-screen bg-panel">
      <TopNav />
      <main className="mx-auto max-w-[1280px] px-8 py-6">
        <CourseDetailView
          courseId={Number(id)}
          initialKeyword={keyword ?? ""}
          initialSort={(sort === "hot" ? "hot" : "latest") as QuestionSort}
          initialUnresolved={unresolved === "1"}
        />
      </main>
    </div>
  );
}
