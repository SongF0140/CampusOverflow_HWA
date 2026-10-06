import { CourseList } from "@/features/courses/CourseList";
import { TopNav } from "@/features/layout/TopNav";

export const metadata = { title: "课程列表 · CampusOverflow" };

// 学生端课程列表（P-S02）：列表页按设计系统 §2 用内容最大宽 1280px，不带右栏
export default async function CoursesPage({
  searchParams,
}: {
  searchParams: Promise<{ keyword?: string; page?: string }>;
}) {
  const { keyword, page } = await searchParams;
  const initialPage = Number(page);

  return (
    <div className="min-h-screen bg-panel">
      <TopNav />
      <main className="mx-auto max-w-[1280px] px-8 py-6">
        <CourseList
          key={keyword ?? "all"}
          initialKeyword={keyword ?? ""}
          initialPage={Number.isInteger(initialPage) && initialPage > 0 ? initialPage : 1}
        />
      </main>
    </div>
  );
}
