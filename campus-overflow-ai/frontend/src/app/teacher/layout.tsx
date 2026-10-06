import { ConsoleShell, type ConsoleNavItem } from "@/features/layout/ConsoleShell";

// 教师端导航（P-T01 ~ P-T05，见前端服务需求文档 §3.2）
const TEACHER_NAV: ConsoleNavItem[] = [
  { href: "/teacher", label: "工作台" },
  { href: "/teacher/courses", label: "我的课程" },
  { href: "/teacher/certify", label: "优质内容认证" },
  { href: "/teacher/moderation", label: "工单处理" },
];

export default function TeacherLayout({ children }: { children: React.ReactNode }) {
  return <ConsoleShell nav={TEACHER_NAV}>{children}</ConsoleShell>;
}
