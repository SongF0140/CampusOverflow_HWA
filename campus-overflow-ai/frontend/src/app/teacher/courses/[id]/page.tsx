import { CourseManageView } from "@/features/teacher/CourseManageView";
import type { QuestionSort } from "@/shared/types/question";

export const metadata = { title: "课程管理 · CampusOverflow" };

// 课程管理详情（P-T03）：四个 Tab；问题的筛选条件从 URL 回填（与课程详情页同一口径）
export default async function TeacherCourseManagePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ keyword?: string; sort?: string; unresolved?: string }>;
}) {
  const [{ id }, { keyword, sort, unresolved }] = await Promise.all([params, searchParams]);

  return (
    <CourseManageView
      courseId={Number(id)}
      initialKeyword={keyword ?? ""}
      initialSort={(sort === "hot" ? "hot" : "latest") as QuestionSort}
      initialUnresolved={unresolved === "1"}
    />
  );
}
