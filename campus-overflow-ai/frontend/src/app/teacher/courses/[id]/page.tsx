import { CourseManageView } from "@/features/teacher/CourseManageView";

export const metadata = { title: "课程管理 · CampusOverflow" };

// 课程管理详情（P-T03，页面控件级设计说明 §3.3）：头卡操作行 + 四个 Tab（页内状态，不写 URL）
export default async function TeacherCourseManagePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return <CourseManageView courseId={Number(id)} />;
}
