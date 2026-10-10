import { AdminCoursesView } from "@/features/admin/AdminCoursesView";

// 课程管理（页面控件级设计说明 §4.3）：登录与管理员守卫由 src/proxy.ts 服务端完成
export default function AdminCoursesPage() {
  return <AdminCoursesView />;
}
