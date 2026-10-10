import { TeacherGuard } from "@/features/layout/TeacherGuard";
import { TeacherShell } from "@/features/layout/TeacherShell";

// 教师端外壳（页面控件级设计说明 §1.2）：顶栏 + 内容区，无左侧栏；页内用 Tab 承载导航
export default function TeacherLayout({ children }: { children: React.ReactNode }) {
  return (
    <TeacherShell>
      <TeacherGuard>{children}</TeacherGuard>
    </TeacherShell>
  );
}
