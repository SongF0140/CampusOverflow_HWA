import { CourseDetailView } from "@/features/courses/CourseDetailView";
import { TopNav } from "@/features/layout/TopNav";

export const metadata = { title: "课程详情 · CampusOverflow" };

// 课程详情（P-S03）：聚合区块 + 问答区都在 CourseDetailView 内按真接口渲染
export default async function CourseDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  return (
    <div className="min-h-screen bg-panel">
      <TopNav />
      <main className="mx-auto max-w-[1280px] px-8 py-6">
        <CourseDetailView courseId={Number(id)} />
      </main>
    </div>
  );
}
