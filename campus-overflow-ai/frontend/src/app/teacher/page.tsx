import { TeacherDashboard } from "@/features/teacher/TeacherDashboard";

export const metadata = { title: "教师工作台 · CampusOverflow" };

// 教师端首屏（P-T01）：外壳（顶栏 + 左侧栏）由 app/teacher/layout.tsx 提供
export default function TeacherHomePage() {
  return <TeacherDashboard />;
}
