import { TopNav } from "@/features/layout/TopNav";
import { TagDetailView } from "@/features/tags/TagDetailView";
import type { QuestionSort } from "@/shared/types/question";

export const metadata = { title: "标签详情 · CampusOverflow" };

// 标签详情（P-S06）：标签名与问题列表分离，问题列表复用 QuestionList 的 tag_id 筛选
export default async function TagDetailPage({
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
        <TagDetailView
          tagId={Number(id)}
          initialKeyword={keyword ?? ""}
          initialSort={(sort === "hot" ? "hot" : "latest") as QuestionSort}
          initialUnresolved={unresolved === "1"}
        />
      </main>
    </div>
  );
}
