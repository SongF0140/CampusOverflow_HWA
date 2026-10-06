import { TeacherCertifyView } from "@/features/teacher/TeacherCertifyView";

export const metadata = { title: "优质内容认证 · CampusOverflow" };

// 优质内容认证（P-T05）：选课程 → 课程问答 → 进问题详情在回答上认证
export default function TeacherCertifyPage() {
  return <TeacherCertifyView />;
}
