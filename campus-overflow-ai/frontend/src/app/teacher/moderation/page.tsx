import { TeacherModerationView } from "@/features/teacher/TeacherModerationView";

export const metadata = { title: "工单处理 · CampusOverflow" };

// 工单处理（P-T04，页面控件级设计说明 §3.4）：双栏骨架——左栏队列 + 右栏详情；
// 治理接口一期统一 501，页面不调接口、不放假数据；?case_id= 预留自动选中挂载点
export default async function TeacherModerationPage({
  searchParams,
}: {
  searchParams: Promise<{ case_id?: string }>;
}) {
  const { case_id } = await searchParams;

  return <TeacherModerationView initialCaseId={case_id ?? null} />;
}
