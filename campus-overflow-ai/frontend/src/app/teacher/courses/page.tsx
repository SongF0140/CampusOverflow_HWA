import { TeacherCourseList } from "@/features/teacher/TeacherCourseList";

export const metadata = { title: "我的课程 · CampusOverflow" };

// 我的课程（P-T02）：新建课程 + 点课程卡进入课程管理详情
export default function TeacherCoursesPage() {
  return <TeacherCourseList />;
}
