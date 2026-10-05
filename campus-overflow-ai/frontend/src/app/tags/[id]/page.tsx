import { TopNav } from "@/features/layout/TopNav";
import { TagDetailView } from "@/features/tags/TagDetailView";

export const metadata = { title: "标签详情 · CampusOverflow" };

// 标签详情（P-S06）：标签名与问题列表分离，问题列表复用 QuestionList 的 tag_id 筛选
export default async function TagDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  return (
    <div className="min-h-screen bg-panel">
      <TopNav />
      <main className="mx-auto max-w-[1280px] px-8 py-6">
        <TagDetailView tagId={Number(id)} />
      </main>
    </div>
  );
}
