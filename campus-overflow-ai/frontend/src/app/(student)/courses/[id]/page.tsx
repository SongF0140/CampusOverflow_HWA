import { CourseDetailView } from "@/features/courses/CourseDetailView";
import { CourseNotFound } from "@/features/courses/CourseNotFound";
import type { QuestionSort } from "@/shared/types/question";

// 课程详情（P-S04 / §2.5）；sort/page 由问答区写入 URL，服务端解析后回填初始值
export default async function CourseDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ sort?: string; page?: string }>;
}) {
  const { id } = await params;
  const { sort, page } = await searchParams;

  const courseId = Number(id);
  if (!Number.isInteger(courseId) || courseId <= 0) {
    return (
      <main className="mx-auto max-w-[1280px] px-4 py-6 sm:px-8">
        <CourseNotFound />
      </main>
    );
  }

  const initialSort: QuestionSort = sort === "hot" ? "hot" : "latest";
  const parsedPage = Number.parseInt(page ?? "1", 10);
  const initialPage = Number.isInteger(parsedPage) && parsedPage > 0 ? parsedPage : 1;

  return (
    <main className="mx-auto max-w-[1280px] px-4 py-6 sm:px-8">
      <CourseDetailView courseId={courseId} initialSort={initialSort} initialPage={initialPage} />
    </main>
  );
}
