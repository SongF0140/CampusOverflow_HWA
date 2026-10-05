import { TopNav } from "@/features/layout/TopNav";
import { PublishForm } from "@/features/questions/PublishForm";

export const metadata = { title: "发布问题 · CampusOverflow" };

export default async function PublishQuestionPage({
  searchParams,
}: {
  searchParams: Promise<{ course_id?: string }>;
}) {
  const { course_id } = await searchParams;
  const initialCourseId = course_id && /^\d+$/.test(course_id) ? Number(course_id) : undefined;

  return (
    <div className="min-h-screen bg-panel">
      <TopNav />
      <main className="mx-auto max-w-[860px] px-8 py-6">
        <PublishForm initialCourseId={initialCourseId} />
      </main>
    </div>
  );
}
