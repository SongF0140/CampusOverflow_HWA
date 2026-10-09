import { CourseListView } from "@/features/courses/CourseListView";

// 课程列表（P-S03 / §2.4）；放在 (student) 路由组内以继承学生端 TopNav，URL 仍为 /courses
export default function CoursesPage() {
  return (
    <main className="mx-auto max-w-[1280px] px-4 py-6 sm:px-8">
      <CourseListView />
    </main>
  );
}
