import { TeacherWorkspaceView } from "@/features/teacher/TeacherWorkspaceView";

export const metadata = { title: "教师工作台 · CampusOverflow" };

// 教师端首屏（P-T01，页面控件级设计说明 §3.1）：指标卡 2×2 + 工单区 + 动态调课
// 外壳（顶栏 + 内容区）与角色守卫由 app/teacher/layout.tsx 提供
export default function TeacherHomePage() {
  return <TeacherWorkspaceView />;
}
